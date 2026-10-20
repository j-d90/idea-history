import { createHash } from "node:crypto";
import { parse as parseYaml, stringify } from "yaml";
import type { z } from "zod";
import {
  eventFieldsSchema,
  ideaFieldsSchema,
  labelOf,
  modeFor,
  type Bibliography,
  type Emergence,
  type Entry,
  type HistoricalEvent,
  type Idea,
  type IdeaLink,
  type ReviewRecord,
} from "./schema.ts";

// Pure content rules, independent of storage: citation syntax, the review
// content hash, cross-record validation, and the Markdown format authors use
// to edit ideas and events. Used by validation, the kg CLI, the site build and
// the agents.

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
  // Split only where the next citation starts, so a locator may contain ";" (or "&amp;" once rendered).
  const parts = inner.split(/;\s*(?=@)/).map((p) => CITE_PART.exec(p.trim()));
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
 * Fingerprint of everything a review vouches for: the entry's content and the
 * bibliography entries it cites. Excludes status, the review record, and aliases
 * (search metadata, not shown). Links are separate records with their own status.
 */
export function contentHash(entry: Entry, bibliography: Bibliography): string {
  const { status: _s, review: _r, aliases: _a, ...rest } = entry;
  const sources = Object.fromEntries(entry.sources.map((k) => [k, bibliography[k] ?? null]));
  return createHash("sha256").update(canonical({ ...rest, sources })).digest("hex").slice(0, 16);
}

/** Key for an entry in maps that hold both ideas and events. */
export const entryKey = (label: string, id: string) => `${label}:${id}`;

const strictStatus = (s: Entry["status"]) => s === "sourced" || s === "checked" || s === "reviewed";
export const isVerified = (s: Entry["status"]): s is "checked" | "reviewed" => s === "checked" || s === "reviewed";
const DIRECTIONAL = new Set(["BUILDS_ON", "REACTS_AGAINST"]);

/** Cross-record rules beyond what the schemas express. Returns every problem found. */
export function checkContent(c: {
  ideas: Idea[];
  events: HistoricalEvent[];
  bibliography: Bibliography;
  links: IdeaLink[];
  emergences: Emergence[];
  /** The latest review record per entry, keyed by entryKey(label, id). */
  latestReviews: Map<string, ReviewRecord>;
}): string[] {
  const problems: string[] = [];
  const byId = new Map(c.ideas.map((i) => [i.id, i]));
  const eventsById = new Map(c.events.map((e) => [e.id, e]));

  for (const entry of [...c.ideas, ...c.events]) {
    const label = labelOf(entry);
    const at = `${label.toLowerCase()} ${entry.id}`;
    problems.push(...checkEntry(entry, c.bibliography).map((p) => `${at}: ${p}`));

    if (isVerified(entry.status)) {
      const mode = modeFor[entry.status];
      if (!entry.review) problems.push(`${at}: status "${entry.status}" requires a review record; only the fact-checker agent may set it`);
      else {
        const hash = contentHash(entry, c.bibliography);
        if (entry.review.hash !== hash) {
          problems.push(`${at}: changed since it was ${entry.status} (hash ${entry.review.hash}, now ${hash}); set it back to "sourced" and re-check`);
        }
        const record = c.latestReviews.get(entryKey(label, entry.id));
        if (!record || record.verdict !== "pass" || record.mode !== mode || record.hash !== entry.review.hash) {
          problems.push(`${at}: no passing ${mode === "check" ? "check" : "review"} record for hash ${entry.review.hash}`);
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

  const pairs = new Set<string>();
  for (const em of c.emergences) {
    const at = `emergence ${em.idea} in ${em.event}`;
    if (pairs.has(`${em.idea}|${em.event}`)) problems.push(`${at}: listed twice`);
    pairs.add(`${em.idea}|${em.event}`);
    if (!byId.has(em.idea)) problems.push(`${at}: idea ${em.idea} does not exist`);
    const event = eventsById.get(em.event);
    if (!event) problems.push(`${at}: event ${em.event} does not exist`);
    else if (event.status === "candidate") problems.push(`${at}: candidate events cannot carry emergences`);
    if (em.sourceKey && !c.bibliography[em.sourceKey]) problems.push(`${at}: unknown source "${em.sourceKey}"`);
  }

  return problems;
}

/** Rules for a single idea or event against the bibliography. */
export function checkEntry(entry: Entry, bibliography: Bibliography): string[] {
  const problems: string[] = [];
  const strict = strictStatus(entry.status);
  const listed = new Set(entry.sources);
  const cited = new Set<string>();

  const seen = new Set<string>();
  for (const key of entry.sources) {
    if (seen.has(key)) problems.push(`sources: "${key}" listed twice`);
    seen.add(key);
    if (!bibliography[key]) problems.push(`sources: "${key}" is not in the bibliography`);
  }
  if (strict && entry.sources.length === 0) problems.push(`status "${entry.status}" requires at least one source`);

  for (const [field, text] of [["body", entry.body], ["date.note", entry.date.note ?? ""]] as const) {
    const { cites, malformed } = scanCitations(text);
    for (const m of malformed) problems.push(`${field}: malformed citation ${m}`);
    for (const ct of cites) {
      cited.add(ct.key);
      if (!listed.has(ct.key)) problems.push(`${field}: cites "${ct.key}", which is not in this entry's sources`);
    }
  }
  if (scanCitations(entry.summary).cites.length) problems.push("summary: citations belong in the body, not the summary");

  if (strict) {
    if (!entry.date.marks) problems.push(`date.marks: status "${entry.status}" requires saying what the date marks`);
    if (!scanCitations(entry.body).cites.length) problems.push(`body: status "${entry.status}" requires at least one [@citation]`);
    for (const key of entry.sources) if (!cited.has(key)) problems.push(`sources: "${key}" is listed but never cited`);
  }
  if (!strict && entry.review) problems.push(`a ${entry.status} entry cannot carry a review`);
  return problems;
}

// ---------- The Markdown editing format ----------

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Render an idea or event for editing: YAML frontmatter plus the Markdown body. The review record is omitted. */
export function entryToMarkdown(entry: Entry): string {
  const { body, review: _r, ...fields } = entry;
  return `---\n${stringify(fields, { lineWidth: 100 })}---\n\n${body}\n`;
}

/** Parse an edited idea. Throws ContentError on syntax or schema problems. */
export function ideaFromMarkdown(text: string): Idea {
  return parseMarkdown(text, ideaFieldsSchema);
}

/** Parse an edited event. Throws ContentError on syntax or schema problems. */
export function eventFromMarkdown(text: string): HistoricalEvent {
  return parseMarkdown(text, eventFieldsSchema);
}

function parseMarkdown<S extends z.ZodTypeAny>(text: string, schema: S): z.infer<S> & { body: string } {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new ContentError(["missing --- frontmatter block"]);
  let data: unknown;
  try {
    data = parseYaml(match[1]);
  } catch (e) {
    throw new ContentError([`invalid YAML: ${(e as Error).message}`]);
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new ContentError(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  return { ...result.data, body: match[2].trim() };
}

// ---------- Quoted excerpts ----------

/** A blockquote line ending in a citation: "> excerpt [@key, locator]". */
const QUOTE_LINE = /^>\s*(.+?)\s*\[(@[^\]]+)\]\s*$/gm;

/**
 * The verbatim excerpts an entry quotes in its body, each with the citation it
 * ends with. These are what the fact-checker's batch check verifies against.
 */
export function quotedExcerpts(body: string): { excerpt: string; key: string; locator?: string }[] {
  const out: { excerpt: string; key: string; locator?: string }[] = [];
  for (const [, excerpt, inner] of body.matchAll(QUOTE_LINE)) {
    const cites = parseCitation(inner);
    if (cites?.length === 1) out.push({ excerpt, key: cites[0].key, locator: cites[0].locator });
  }
  return out;
}
