import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { frontmatterSchema, type Idea } from "../src/content/schema.ts";

export const contentDir = join(import.meta.dirname, "..", "content", "ideas");

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

/** Read, parse and validate every idea. Throws ContentError listing all problems. */
export function loadIdeas(dir = contentDir): Idea[] {
  const problems: string[] = [];
  const ideas: Idea[] = [];
  const paths = new Map<string, string>();

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const path = relative(process.cwd(), join(dir, file));
    const id = file.slice(0, -3);
    const report = (msg: string) => problems.push(`${path}: ${msg}`);

    if (!ID.test(id)) report("filename must be kebab-case, e.g. printing-press.md");

    const match = FRONTMATTER.exec(readFileSync(join(dir, file), "utf8"));
    if (!match) {
      report("missing --- frontmatter block");
      continue;
    }

    let raw: unknown;
    try {
      raw = parseYaml(match[1]);
    } catch (e) {
      report(`invalid YAML: ${(e as Error).message}`);
      continue;
    }

    const result = frontmatterSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        report(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
      }
      continue;
    }

    ideas.push({ id, body: match[2].trim(), ...result.data });
    paths.set(id, path);
  }

  problems.push(...checkIdeas(ideas, paths));
  if (problems.length) throw new ContentError(problems);
  return ideas.sort((a, b) => a.date.year - b.date.year || a.id.localeCompare(b.id));
}

/** Rules that span fields or files, beyond what the schema can express. */
function checkIdeas(ideas: Idea[], paths: Map<string, string>): string[] {
  const problems: string[] = [];
  const byId = new Map(ideas.map((i) => [i.id, i]));

  for (const idea of ideas) {
    const at = paths.get(idea.id)!;
    const needsSources = idea.status !== "draft";
    const keys = new Set<string>();

    for (const s of idea.sources) {
      if (keys.has(s.key)) problems.push(`${at}: duplicate source key "${s.key}"`);
      keys.add(s.key);
    }

    if (needsSources && idea.sources.length === 0) {
      problems.push(`${at}: status "${idea.status}" requires at least one source`);
    }

    for (const link of idea.buildsOn) {
      const target = byId.get(link.id);
      const where = `${at}: buildsOn "${link.id}"`;

      if (link.id === idea.id) problems.push(`${where}: an idea cannot build on itself`);
      else if (!target) problems.push(`${where}: no such idea`);
      else if (target.date.year > idea.date.year) {
        problems.push(`${where}: points forward in time (${target.date.year} > ${idea.date.year})`);
      }

      for (const key of link.sources) {
        if (!keys.has(key)) problems.push(`${where}: unknown source key "${key}"`);
      }

      if (needsSources && !link.why) {
        problems.push(`${where}: status "${idea.status}" requires a "why"`);
      }
      if (needsSources && link.sources.length === 0) {
        problems.push(`${where}: status "${idea.status}" requires at least one source`);
      }
    }
  }

  return problems;
}
