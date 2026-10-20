import { z } from "zod/v4";
import { categories, entityKinds } from "../../src/content/schema.ts";
import type { EvidenceLedger } from "../core/evidence.ts";
import { disallowedEvidence } from "../core/policy.ts";
import { defineTool, ToolError } from "../core/tools/types.ts";

// The extractor's structured output and the harness checks applied to it.
// Strict tool schema: every field required (nullable instead of optional), no
// length or numeric constraints (those are checked here instead).

const EntityRef = z.strictObject({
  existing_id: z.string().nullable().describe("Id of the matching entity from find_similar_entities, or null if new"),
  name: z.string(),
  kind: z.enum(entityKinds),
  role: z.string().describe("How it relates to the idea, e.g. originator, place of origin, key text, tradition"),
  description: z.string().describe("One short neutral sentence"),
  aliases: z.array(z.string()),
});

const ExtractedIdea = z.strictObject({
  existing_id: z.string().nullable().describe("Id of the same idea already in the graph (under any name), or null if new"),
  title: z.string(),
  summary: z.string().describe("One or two neutral sentences, at most 320 characters"),
  aliases: z.array(z.string()).describe("Other names the document uses for this idea"),
  category: z.enum(categories),
  year: z.number().nullable().describe("Best placement year, negative for BCE; required for new ideas"),
  year_basis: z.string().nullable().describe("What the year marks and why, from the document; required for new ideas"),
  approx: z.boolean(),
  origin: z.string().nullable().describe("Who / where, as a short byline; required for new ideas"),
  evidence: z.string().describe("Verbatim excerpt (at most 40 words) showing the document discusses the idea"),
  evidence_url: z.string().describe("URL of the document the excerpt comes from, as you read it"),
  locator: z.string().nullable().describe("Printed page or section"),
  entities: z.array(EntityRef),
});

export const ExtractionSchema = z.strictObject({
  ideas: z.array(ExtractedIdea),
  notes: z.string().describe("Anything the curator should know: ideas left out and why, doubts about matches"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedIdea = z.infer<typeof ExtractedIdea>;

export interface ExtractionContext {
  evidence: EvidenceLedger;
  ideaExists: (id: string) => boolean;
  entityExists: (id: string) => boolean;
}

const MAX_IDEAS = 12;
const MAX_REJECTIONS = 3;

export function checkExtraction(x: Extraction, ctx: ExtractionContext): string[] {
  const problems: string[] = [];
  if (x.ideas.length > MAX_IDEAS) problems.push(`at most ${MAX_IDEAS} ideas per document; keep the ones it substantially discusses`);

  const seen = new Set<string>();
  x.ideas.forEach((idea, n) => {
    const at = `ideas[${n}] "${idea.title}"`;
    const key = idea.existing_id ?? idea.title.trim().toLowerCase();
    if (seen.has(key)) problems.push(`${at}: listed twice`);
    seen.add(key);

    if (idea.existing_id && !ctx.ideaExists(idea.existing_id)) problems.push(`${at}: no idea with id "${idea.existing_id}"`);
    if (!idea.existing_id) {
      if (!idea.title.trim()) problems.push(`${at}: a new idea needs a title`);
      if (idea.year === null || !Number.isInteger(idea.year)) problems.push(`${at}: a new idea needs an integer year`);
      if (!idea.year_basis?.trim()) problems.push(`${at}: a new idea needs year_basis`);
      if (!idea.origin?.trim()) problems.push(`${at}: a new idea needs an origin`);
    }
    if (idea.summary.length > 320) problems.push(`${at}: summary is ${idea.summary.length} characters; the limit is 320`);
    if (idea.evidence.split(/\s+/).length > 45) problems.push(`${at}: evidence is longer than 40 words`);
    const doc = ctx.evidence.locate(idea.evidence, idea.evidence_url);
    if (!doc) problems.push(`${at}: the excerpt was not found in any document read during this run; quote exactly (use search_source to confirm)`);
    else if (disallowedEvidence(doc.finalUrl)) problems.push(`${at}: ${disallowedEvidence(doc.finalUrl)}`);
    for (const e of idea.entities) {
      if (e.existing_id && !ctx.entityExists(e.existing_id)) problems.push(`${at}: no entity with id "${e.existing_id}"`);
    }
  });
  return problems;
}

export interface AcceptedExtraction {
  extraction: Extraction;
  /** Document each idea's excerpt was found in. */
  evidenceUrls: string[];
}

export function createSubmitExtractionTool(ctx: ExtractionContext, onAccept: (a: AcceptedExtraction) => void, onGiveUp: (problems: string[]) => void) {
  let rejections = 0;
  let accepted = false;
  return defineTool({
    name: "submit_extraction",
    description:
      "Submit the ideas and entities you extracted from the document. Call this once, when you're done. The harness checks every excerpt " +
      "against the documents you read, that matched ids exist, and that new ideas have a year, basis and origin; if anything fails you get " +
      "the list of problems and must fix them and submit again.",
    input: ExtractionSchema,
    strict: true,
    async run(extraction) {
      if (accepted) throw new ToolError("An extraction has already been accepted for this run.");
      const problems = checkExtraction(extraction, ctx);
      if (problems.length) {
        if (++rejections > MAX_REJECTIONS) {
          onGiveUp(problems);
          throw new ToolError(`Rejected too many times; this run ends without saving.\n- ${problems.join("\n- ")}`);
        }
        throw new ToolError(`Submission rejected (${rejections}/${MAX_REJECTIONS}). Fix these and submit again:\n- ${problems.join("\n- ")}`);
      }
      accepted = true;
      onAccept({ extraction, evidenceUrls: extraction.ideas.map((i) => ctx.evidence.locate(i.evidence, i.evidence_url)!.finalUrl) });
      return "Extraction accepted. You are done; reply with a one-line summary.";
    },
  });
}
