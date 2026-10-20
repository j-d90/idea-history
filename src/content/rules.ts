import { createHash } from "node:crypto";
import { parse as parseYaml, stringify } from "yaml";
import {
  ideaFieldsSchema,
  type Bibliography,
  type Idea,
  type IdeaLink,
  type ReviewRecord,
} from "./schema.ts";

// Pure content rules, independent of storage: citation syntax, the review
// content hash, cross-record validation, and the Markdown format authors use
// to edit ideas. Used by validation, the kg CLI, the site build and the agents.

/** [@key], [@key, p. 3], [@a; @b, ch. 2] */
export const CITATION = /\[(@[^\]]*)\]/g;
const CITE_PART = /^@([a-z0-9]+(?:-[a-z0-9]+)*)(?:,\s*(.+))?$/;

export interface Citation {
  key: string;
  locator?: string;
}

export class ContentError extends Error {
  problems: string[];

  constructor(problems: string[]) {
    super(`Content validation failed with ${problems.length} problem(s):\n` + problems.map((p) => `  - ${p}`).join("\n"));
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
export function scanCitations(text: string): { cites: Citation[]; malformed: string[] } {
  const cites: Citation[] = [];
  const malformed: string[] = [];
  for (const [whole, inner] of text.matchAll(CITATION)) {
    const parsed = parseCitation(inner);
    if (parsed) cites.push(...parsed);
    else malformed.push(whole);
  }
  return { cites, malformed };
}

/** Deterministic JSON: object keys sorted, undefined dropped. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  );
}

/**
 * Fingerprint of everything a review vouches for: the idea's content and the
 * bibliography entries it cites. Excludes status, the review record, and aliases
 * (search metadata, not shown). Links are separate records with their own status.
 */
export function contentHash(idea: Idea, bibliography: Bibliography): string {
  const { status: _s, review: _r, aliases: _a, ...rest } = idea;
  const sources = Object.fromEntries(idea.sources.map((k) => [k, bibliography[k] ?? null]));
  return createHash("sha256").update(canonical({ ...rest, sources })).digest("hex").slice(0, 16);
}

const strictStatus = (s: Idea["status"]) => s === "sourced" || s === "reviewed";
const DIRECTIONAL = new Set(["BUILDS_ON", "REACTS_AGAINST"]);

/** Cross-record rules beyond what the schemas express. Returns every problem found. */
export function checkContent(c: {
  ideas: Idea[];
  bibliography: Bibliography;
  links: IdeaLink[];
  /** The latest review record per idea. */
  latestReviews: Map<string, ReviewRecord>;
}): string[] {
  const problems: string[] = [];
  const byId = new Map(c.ideas.map((i) => [i.id, i]));

  for (const idea of c.ideas) {
    problems.push(...checkIdea(idea, c.bibliography).map((p) => `idea ${idea.id}: ${p}`));

    if (idea.status === "reviewed") {
      const at = `idea ${idea.id}`;
      if (!idea.review) problems.push(`${at}: status "reviewed" requires a review record; only the fact-checker agent may set it`);
      else {
        const hash = contentHash(idea, c.bibliography);
        if (idea.review.hash !== hash) {
          problems.push(`${at}: changed since it was reviewed (hash ${idea.review.hash}, now ${hash}); set it back to "sourced" and re-review`);
        }
        const record = c.latestReviews.get(idea.id);
        if (!record || record.verdict !== "pass" || record.hash !== idea.review.hash) {
          problems.push(`${at}: no passing review record for hash ${idea.review.hash}`);
        }
      }
    }
  }

  for (const link of c.links) {
    const at = `link ${link.from} -${link.type}-> ${link.to}`;
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (link.from === link.to) problems.push(`${at}: an idea cannot link to itself`);
    if (!from || !to) {
      problems.push(`${at}: ${!from ? link.from : link.to} does not exist`);
      continue;
    }
    if (from.status === "candidate" || to.status === "candidate") problems.push(`${at}: candidate ideas cannot be linked`);
    if (DIRECTIONAL.has(link.type) && to.date.year > from.date.year) {
      problems.push(`${at}: points forward in time (${to.date.year} > ${from.date.year})`);
    }
    if (link.origin === "linker" && (!link.why || !link.evidence || !link.evidenceUrl)) {
      problems.push(`${at}: linker links need a why, evidence and evidenceUrl`);
    }
    if (link.sourceKey && !c.bibliography[link.sourceKey]) problems.push(`${at}: unknown source "${link.sourceKey}"`);
  }

  return problems;
}

/** Rules for a single idea against the bibliography. */
export function checkIdea(idea: Idea, bibliography: Bibliography): string[] {
  const problems: string[] = [];
  const strict = strictStatus(idea.status);
  const listed = new Set(idea.sources);
  const cited = new Set<string>();

  const seen = new Set<string>();
  for (const key of idea.sources) {
    if (seen.has(key)) problems.push(`sources: "${key}" listed twice`);
    seen.add(key);
    if (!bibliography[key]) problems.push(`sources: "${key}" is not in the bibliography`);
  }
  if (strict && idea.sources.length === 0) problems.push(`status "${idea.status}" requires at least one source`);

  for (const [field, text] of [["body", idea.body], ["date.note", idea.date.note ?? ""]] as const) {
    const { cites, malformed } = scanCitations(text);
    for (const m of malformed) problems.push(`${field}: malformed citation ${m}`);
    for (const ct of cites) {
      cited.add(ct.key);
      if (!listed.has(ct.key)) problems.push(`${field}: cites "${ct.key}", which is not in this idea's sources`);
    }
  }
  if (scanCitations(idea.summary).cites.length) problems.push("summary: citations belong in the body, not the summary");

  if (strict) {
    if (!idea.date.marks) problems.push(`date.marks: status "${idea.status}" requires saying what the date marks`);
    if (!scanCitations(idea.body).cites.length) problems.push(`body: status "${idea.status}" requires at least one [@citation]`);
    for (const key of idea.sources) if (!cited.has(key)) problems.push(`sources: "${key}" is listed but never cited`);
  }
  if (!strict && idea.review) problems.push(`a ${idea.status} idea cannot carry a review`);
  return problems;
}

// ---------- The Markdown editing format ----------

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Render an idea for editing: YAML frontmatter plus the Markdown body. The review record is omitted. */
export function ideaToMarkdown(idea: Idea): string {
  const { body, review: _r, ...fields } = idea;
  return `---\n${stringify(fields, { lineWidth: 100 })}---\n\n${body}\n`;
}

/** Parse an edited idea. Throws ContentError on syntax or schema problems. */
export function ideaFromMarkdown(text: string): Idea {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new ContentError(["missing --- frontmatter block"]);
  let data: unknown;
  try {
    data = parseYaml(match[1]);
  } catch (e) {
    throw new ContentError([`invalid YAML: ${(e as Error).message}`]);
  }
  const result = ideaFieldsSchema.safeParse(data);
  if (!result.success) throw new ContentError(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  return { ...result.data, body: match[2].trim() };
}
