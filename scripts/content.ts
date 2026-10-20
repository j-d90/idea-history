import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  bibliographySchema,
  frontmatterSchema,
  reportSchema,
  type Bibliography,
  type Idea,
} from "../src/content/schema.ts";

export const contentRoot = join(import.meta.dirname, "..", "content");

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** [@key], [@key, p. 3], [@a; @b, ch. 2] */
export const CITATION = /\[(@[^\]]*)\]/g;
const CITE_PART = /^@([a-z0-9]+(?:-[a-z0-9]+)*)(?:,\s*(.+))?$/;

export interface Citation {
  key: string;
  locator?: string;
}

export interface Content {
  ideas: Idea[];
  bibliography: Bibliography;
  warnings: string[];
}

export class ContentError extends Error {
  problems: string[];

  constructor(problems: string[]) {
    super(
      `Content validation failed with ${problems.length} problem(s):\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
    this.name = "ContentError";
    this.problems = problems;
  }
}

/** Parse the inside of a [@...] group. Returns null if malformed. */
export function parseCitation(inner: string): Citation[] | null {
  const parts = inner.split(";").map((p) => CITE_PART.exec(p.trim()));
  if (parts.some((m) => !m)) return null;
  return parts.map((m) => ({ key: m![1], locator: m![2]?.trim() }));
}

/** Every citation group in a text, with malformed groups reported. */
function scanCitations(text: string): { cites: Citation[]; malformed: string[] } {
  const cites: Citation[] = [];
  const malformed: string[] = [];
  for (const [whole, inner] of text.matchAll(CITATION)) {
    const parsed = parseCitation(inner);
    if (parsed) cites.push(...parsed);
    else malformed.push(whole);
  }
  return { cites, malformed };
}

function splitFrontmatter(path: string): { data: unknown; body: string } | string {
  const match = FRONTMATTER.exec(readFileSync(path, "utf8"));
  if (!match) return "missing --- frontmatter block";
  try {
    return { data: parseYaml(match[1]), body: match[2].trim() };
  } catch (e) {
    return `invalid YAML: ${(e as Error).message}`;
  }
}

/** Deterministic JSON: object keys sorted, undefined dropped. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  );
}

/**
 * Fingerprint of everything a review vouches for: the idea's content (minus its
 * status and review record) and the bibliography entries it cites.
 */
export function contentHash(idea: Idea, bibliography: Bibliography): string {
  const { status: _s, review: _r, ...rest } = idea;
  const sources = Object.fromEntries(idea.sources.map((k) => [k, bibliography[k] ?? null]));
  return createHash("sha256").update(canonical({ ...rest, sources })).digest("hex").slice(0, 16);
}

/** Read, parse and validate all content. Throws ContentError listing every problem. */
export function loadContent(root = contentRoot): Content {
  const problems: string[] = [];
  const warnings: string[] = [];
  const rel = (p: string) => relative(process.cwd(), p);

  // Bibliography
  const bibPath = join(root, "sources.yaml");
  const bibliography: Bibliography = {};
  let rawBib: Record<string, unknown> = {};
  try {
    rawBib = parseYaml(readFileSync(bibPath, "utf8")) ?? {};
  } catch (e) {
    problems.push(`${rel(bibPath)}: ${(e as Error).message}`);
  }
  // Validate entry by entry so one bad entry doesn't cascade into every idea citing others.
  for (const [key, entry] of Object.entries(rawBib)) {
    const parsed = bibliographySchema.safeParse({ [key]: entry });
    if (parsed.success) Object.assign(bibliography, parsed.data);
    else {
      for (const issue of parsed.error.issues) {
        problems.push(`${rel(bibPath)}: ${issue.path.join(".")}: ${issue.message}`);
      }
    }
  }

  // Ideas
  const ideasDir = join(root, "ideas");
  const ideas: Idea[] = [];
  const paths = new Map<string, string>();

  for (const file of readdirSync(ideasDir).filter((f) => f.endsWith(".md")).sort()) {
    const path = rel(join(ideasDir, file));
    const id = file.slice(0, -3);
    const report = (msg: string) => problems.push(`${path}: ${msg}`);

    if (!ID.test(id)) report("filename must be kebab-case, e.g. printing-press.md");

    const split = splitFrontmatter(join(ideasDir, file));
    if (typeof split === "string") {
      report(split);
      continue;
    }

    const result = frontmatterSchema.safeParse(split.data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        report(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
      }
      continue;
    }

    ideas.push({ id, body: split.body, ...result.data });
    paths.set(id, path);
  }

  problems.push(...checkIdeas(ideas, bibliography, paths, join(root, "reviews")));

  // Bibliography entries nobody cites
  const used = new Set(ideas.flatMap((i) => i.sources));
  for (const key of Object.keys(bibliography)) {
    if (!used.has(key)) warnings.push(`${rel(bibPath)}: "${key}" is not used by any idea`);
  }

  if (problems.length) throw new ContentError(problems);
  ideas.sort((a, b) => a.date.year - b.date.year || a.id.localeCompare(b.id));
  return { ideas, bibliography, warnings };
}

/** Rules that span fields or files, beyond what the schema can express. */
function checkIdeas(
  ideas: Idea[],
  bibliography: Bibliography,
  paths: Map<string, string>,
  reviewsDir: string,
): string[] {
  const problems: string[] = [];
  const byId = new Map(ideas.map((i) => [i.id, i]));

  for (const idea of ideas) {
    const at = paths.get(idea.id)!;
    const add = (msg: string) => problems.push(`${at}: ${msg}`);
    const strict = idea.status !== "draft";
    const listed = new Set(idea.sources);
    const cited = new Set<string>();

    // Sources
    const seen = new Set<string>();
    for (const key of idea.sources) {
      if (seen.has(key)) add(`sources: "${key}" listed twice`);
      seen.add(key);
      if (!bibliography[key]) add(`sources: "${key}" is not in content/sources.yaml`);
    }
    if (strict && idea.sources.length === 0) add(`status "${idea.status}" requires at least one source`);

    // Citations in prose
    const texts: [string, string][] = [
      ["body", idea.body],
      ["date.note", idea.date.note ?? ""],
    ];
    for (const [field, text] of texts) {
      const { cites, malformed } = scanCitations(text);
      for (const m of malformed) add(`${field}: malformed citation ${m}`);
      for (const c of cites) {
        cited.add(c.key);
        if (!listed.has(c.key)) add(`${field}: cites "${c.key}", which is not in this idea's sources`);
      }
    }
    if (CITATION.test(idea.summary)) add("summary: citations belong in the body, not the summary");
    CITATION.lastIndex = 0;

    if (strict) {
      if (!idea.date.marks) add(`date.marks: status "${idea.status}" requires saying what the date marks`);
      if (!scanCitations(idea.body).cites.length) {
        add(`body: status "${idea.status}" requires a body with at least one [@citation]`);
      }
    }

    // Links
    for (const link of idea.buildsOn) {
      const target = byId.get(link.id);
      const where = `buildsOn "${link.id}"`;

      if (link.id === idea.id) add(`${where}: an idea cannot build on itself`);
      else if (!target) add(`${where}: no such idea`);
      else if (target.date.year > idea.date.year) {
        add(`${where}: points forward in time (${target.date.year} > ${idea.date.year})`);
      }

      for (const key of link.sources) {
        cited.add(key);
        if (!listed.has(key)) add(`${where}: cites "${key}", which is not in this idea's sources`);
      }
      if (strict && !link.why) add(`${where}: status "${idea.status}" requires a "why"`);
      if (strict && link.sources.length === 0) add(`${where}: status "${idea.status}" requires at least one source`);
    }

    if (strict) {
      for (const key of idea.sources) {
        if (!cited.has(key)) add(`sources: "${key}" is listed but never cited`);
      }
    }

    // Review
    if (idea.status === "draft" && idea.review) add("a draft cannot carry a review");
    if (idea.status === "reviewed") problems.push(...checkReview(idea, bibliography, at, reviewsDir));
  }

  return problems;
}

function checkReview(idea: Idea, bibliography: Bibliography, at: string, reviewsDir: string): string[] {
  const problems: string[] = [];
  const add = (msg: string) => problems.push(`${at}: ${msg}`);

  if (!idea.review) {
    add('status "reviewed" requires a review record; only the fact-checker agent may set it');
    return problems;
  }

  const hash = contentHash(idea, bibliography);
  if (idea.review.hash !== hash) {
    add(
      `changed since it was reviewed (hash ${idea.review.hash}, now ${hash}). ` +
        `Set status back to "sourced" and have the fact-checker review it again.`,
    );
  }

  const reportPath = join(reviewsDir, `${idea.id}.md`);
  if (!existsSync(reportPath)) {
    add(`review report content/reviews/${idea.id}.md is missing`);
    return problems;
  }
  const split = splitFrontmatter(reportPath);
  const report = typeof split === "string" ? null : reportSchema.safeParse(split.data);
  if (!report?.success) {
    add(`review report content/reviews/${idea.id}.md has invalid frontmatter`);
  } else if (report.data.verdict !== "pass" || report.data.hash !== idea.review.hash) {
    add(`review report does not record a pass for hash ${idea.review.hash}`);
  }
  return problems;
}
