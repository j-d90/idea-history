import { z } from "zod/v4";
import { sourceKey, sourceSchema, type Bibliography, type Source } from "../../src/content/schema.ts";
import type { EvidenceLedger, SourceDocument } from "./evidence.ts";
import { disallowedEvidence } from "./policy.ts";
import { defineTool, ToolError } from "./tools/types.ts";

// Agents that write content (gatherer, author) cite sources. They may cite a
// source already in the graph, or register a new one they read during the run.
// Either way, every citation must be backed by a verbatim excerpt found in that
// source's own document, so a source can't be cited for something it doesn't say.

/** A bibliography entry an agent proposes. Strict tool schema: nullable instead of optional. */
export const ProposedSource = z.strictObject({
  key: z.string().describe("New bibliography key, kebab-case: first author's surname and year, e.g. 'cooper-1983'"),
  type: z.enum(["primary", "secondary", "reference"]).describe("primary: an ancient text or inscription; secondary: scholarship; reference: an encyclopedia or survey"),
  kind: z.enum(["book", "chapter", "article", "preprint", "web", "text"]),
  authors: z.array(z.string()).describe("Personal names only. For a work by an institution with no named author, leave this empty and set short"),
  editors: z.array(z.string()),
  translators: z.array(z.string()),
  title: z.string(),
  container: z.string().nullable().describe("Journal, edited book or website; required for articles and chapters"),
  publisher: z.string().nullable().describe("Required for books and chapters"),
  volume: z.string().nullable(),
  issue: z.string().nullable(),
  pages: z.string().nullable().describe("Printed page range of the work, e.g. 'pp. 189–195'"),
  year: z.string().describe("Publication year, e.g. '2010'"),
  doi: z.string().nullable().describe("Bare DOI, e.g. 10.1017/S0021911800000000"),
  short: z.string().nullable().describe("In-text label for works without personal authors or editors, e.g. 'Louvre, AO 50'; otherwise null"),
  url: z.string().describe("The URL you read the work at during this run"),
});

export type ProposedSource = z.infer<typeof ProposedSource>;

export function toSource(p: ProposedSource, today: string): Source {
  const year = /^-?\d+$/.test(p.year.trim()) ? Number(p.year.trim()) : p.year.trim();
  const opt = (v: string | null) => (v?.trim() ? v.trim() : undefined);
  return sourceSchema.parse({
    type: p.type,
    kind: p.kind,
    authors: p.authors,
    editors: p.editors,
    translators: p.translators,
    title: p.title.trim(),
    container: opt(p.container),
    publisher: opt(p.publisher),
    volume: opt(p.volume),
    issue: opt(p.issue),
    pages: opt(p.pages),
    year,
    doi: opt(p.doi),
    short: opt(p.short),
    url: p.url,
    accessed: today,
    consulted: true,
  });
}

/** The document a source was read from during this run, if it was. */
export function sourceDocument(source: Source, evidence: EvidenceLedger): SourceDocument | undefined {
  return (source.url ? evidence.get(source.url) : undefined) ?? (source.doi ? evidence.get(`https://doi.org/${source.doi}`) : undefined);
}

/** Problems with newly proposed sources: key, schema, policy, and that the agent read them. */
export function checkNewSources(proposed: ProposedSource[], ctx: { evidence: EvidenceLedger; sourceExists: (key: string) => boolean; today: string }): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of proposed) {
    const at = `new source "${p.key}"`;
    if (!sourceKey.safeParse(p.key).success) problems.push(`${at}: keys use lowercase letters, digits and hyphens`);
    if (ctx.sourceExists(p.key)) problems.push(`${at}: that key is already in the bibliography; cite it by key instead, or choose another key`);
    if (seen.has(p.key)) problems.push(`${at}: proposed twice`);
    seen.add(p.key);
    const parsed = (() => {
      try {
        return toSource(p, ctx.today);
      } catch (e) {
        const issues = e instanceof z.ZodError ? e.issues : ((e as { issues?: { path: PropertyKey[]; message: string }[] }).issues ?? []);
        problems.push(...issues.map((i) => `${at}: ${i.path.join(".") || "(entry)"}: ${i.message}`));
        if (!issues.length) problems.push(`${at}: ${(e as Error).message}`);
        return undefined;
      }
    })();
    if (!parsed) continue;
    if (disallowedEvidence(p.url)) problems.push(`${at}: ${disallowedEvidence(p.url)}`);
    if (!sourceDocument(parsed, ctx.evidence)) problems.push(`${at}: ${p.url} was not read during this run; read the work itself before citing it`);
  }
  return problems;
}

/**
 * Check that `excerpt` appears verbatim in the document of the source cited as
 * `key` (from `bibliography`, which should include any new sources). Returns a
 * problem, or null if the excerpt is verified.
 */
export function checkCitedExcerpt(at: string, key: string, excerpt: string, bibliography: Bibliography, evidence: EvidenceLedger): string | null {
  const source = bibliography[key];
  if (!source) return `${at}: no source with key "${key}"`;
  const doc = sourceDocument(source, evidence);
  if (!doc) return `${at}: "${key}" (${source.url ?? `doi:${source.doi}`}) was not read during this run; read it before citing it`;
  if (disallowedEvidence(doc.finalUrl)) return `${at}: ${disallowedEvidence(doc.finalUrl)}`;
  if (excerpt.split(/\s+/).length > 45) return `${at}: the excerpt is longer than 40 words`;
  if (!evidence.locateIn(excerpt, source.url ?? `https://doi.org/${source.doi}`) && !(source.doi && evidence.locateIn(excerpt, `https://doi.org/${source.doi}`))) {
    return `${at}: the excerpt was not found in "${key}" as read at ${doc.finalUrl}; quote that source exactly (use search_source to confirm)`;
  }
  return null;
}

/** A citation an agent submits: which source, where in it, and a verbatim excerpt from it. */
export const Citation = z.strictObject({
  source_key: z.string().describe("Key of a source already in the graph, or of one in new_sources"),
  locator: z.string().nullable().describe("Printed page, section or line, e.g. 'p. 37' or 'col. ii 4–7'"),
  excerpt: z.string().describe("Verbatim excerpt (at most 40 words) from that source supporting the claim"),
});

export type Citation = z.infer<typeof Citation>;

/** A Markdown citation for a body: [@key, locator]. */
export const cite = (c: Pick<Citation, "source_key" | "locator">) => `[@${c.source_key}${c.locator?.trim() ? `, ${c.locator.trim()}` : ""}]`;

/** Render an excerpt as a cited Markdown blockquote. */
export const quote = (c: Citation) => `> ${c.excerpt.replace(/\s+/g, " ").trim()} ${cite(c)}`;

/** Sources registered during one run, by key. Only the ones a submission cites are saved. */
export type SourceRegistry = Map<string, Source>;

/**
 * The register_source tool: an agent registers each new work right after reading
 * it, and the harness checks the entry (key, fields, policy, that it was read)
 * on the spot. Submissions then cite it by key.
 */
export function createRegisterSourceTool(ctx: { evidence: EvidenceLedger; sourceExists: (key: string) => boolean; today: string }, registry: SourceRegistry) {
  return defineTool({
    name: "register_source",
    description:
      "Register a work you have read during this run and want to cite, if it isn't in the graph yet. Call this right after reading it. " +
      "The harness checks the entry (key format, required fields for its kind, the source policy, and that you read the url) and either " +
      "registers it under its key or tells you what to fix. Cite sources already in the graph by their existing key instead.",
    input: ProposedSource,
    strict: true,
    async run(proposed) {
      const replacing = registry.has(proposed.key);
      const problems = checkNewSources([proposed], { ...ctx, sourceExists: (k) => ctx.sourceExists(k) });
      if (problems.length) throw new ToolError(`Not registered. Fix these and try again:\n- ${problems.join("\n- ")}`);
      registry.set(proposed.key, toSource(proposed, ctx.today));
      return `${replacing ? "Updated" : "Registered"} "${proposed.key}". Cite it with source_key "${proposed.key}".`;
    },
  });
}
