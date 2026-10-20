import { z } from "zod/v4";
import { categories, emergenceStages } from "../../src/content/schema.ts";
import type { EvidenceLedger } from "../core/evidence.ts";
import { disallowedEvidence } from "../core/policy.ts";
import { defineTool, ToolError } from "../core/tools/types.ts";

// The interpreter's structured output and the harness checks applied to it.

const ProposedEmergence = z.strictObject({
  event_id: z.string(),
  stage: z.enum(emergenceStages),
  why: z.string().describe("One sentence: how this event shows the idea at this stage"),
  evidence: z.string().describe("Verbatim excerpt (at most 40 words) from a document you read, connecting the event to the idea"),
  evidence_url: z.string().describe("URL of the document the excerpt comes from, as you read it"),
  source_key: z.string().nullable().describe("Bibliography key, if the document is a source already in the graph"),
  locator: z.string().nullable().describe("Printed page or section"),
  confidence: z.enum(["low", "medium", "high"]),
});

const IdentifiedIdea = z.strictObject({
  existing_id: z.string().nullable().describe("Id of the same idea already in the graph (under any name), or null if new"),
  title: z.string(),
  summary: z.string().describe("For new ideas: one or two neutral sentences, at most 320 characters"),
  category: z.enum(categories),
  origin: z.string().nullable().describe("For new ideas: who / where, as a short byline"),
  year: z.number().nullable().describe("For new ideas: best placement year, negative for BCE"),
  year_basis: z.string().nullable().describe("For new ideas: what the year marks and why"),
  approx: z.boolean(),
  aliases: z.array(z.string()).describe("Other names sources use for the idea itself (not names of the event or object that shows it)"),
  emergences: z.array(ProposedEmergence),
});

export const InterpretationSchema = z.strictObject({
  ideas: z.array(IdentifiedIdea),
  events_without_ideas: z.array(z.strictObject({ event_id: z.string(), reason: z.string() })),
  notes: z.string().describe("Anything the curator should know: doubts, ideas considered and rejected"),
});

export type Interpretation = z.infer<typeof InterpretationSchema>;

export interface InterpretContext {
  evidence: EvidenceLedger;
  /** The period's events and their years; each must be accounted for. */
  events: Map<string, number>;
  ideaExists: (id: string) => boolean;
  sourceExists: (key: string) => boolean;
}

export const MAX_IDEAS = 15;
const MAX_REJECTIONS = 3;

export function checkInterpretation(x: Interpretation, ctx: InterpretContext): string[] {
  const problems: string[] = [];
  if (x.ideas.length > MAX_IDEAS) problems.push(`at most ${MAX_IDEAS} ideas per run; keep the best-evidenced`);

  const seenIdeas = new Set<string>();
  const pairs = new Set<string>();
  const covered = new Set<string>();
  x.ideas.forEach((idea, n) => {
    const at = `ideas[${n}] "${idea.title}"`;
    const key = idea.existing_id ?? idea.title.trim().toLowerCase();
    if (seenIdeas.has(key)) problems.push(`${at}: listed twice; put all its emergences under one entry`);
    seenIdeas.add(key);

    if (idea.existing_id && !ctx.ideaExists(idea.existing_id)) problems.push(`${at}: no idea with id "${idea.existing_id}"`);
    if (!idea.existing_id) {
      if (!idea.title.trim()) problems.push(`${at}: a new idea needs a title`);
      if (!idea.summary.trim()) problems.push(`${at}: a new idea needs a summary`);
      if (idea.year === null || !Number.isInteger(idea.year) || idea.year === 0) problems.push(`${at}: a new idea needs an integer year (no year 0)`);
      if (!idea.year_basis?.trim()) problems.push(`${at}: a new idea needs year_basis`);
      if (!idea.origin?.trim()) problems.push(`${at}: a new idea needs an origin`);
    }
    if (idea.summary.length > 320) problems.push(`${at}: summary is ${idea.summary.length} characters; the limit is 320`);
    if (!idea.emergences.length) problems.push(`${at}: needs at least one emergence; ideas are identified from this period's events`);

    for (const em of idea.emergences) {
      const eat = `${at} in "${em.event_id}"`;
      const eventYear = ctx.events.get(em.event_id);
      if (eventYear === undefined) problems.push(`${eat}: not one of this period's events`);
      if (pairs.has(`${key}|${em.event_id}`)) problems.push(`${eat}: listed twice (choose one stage)`);
      pairs.add(`${key}|${em.event_id}`);
      covered.add(em.event_id);
      if (!idea.existing_id && idea.year !== null && eventYear !== undefined && em.stage === "earliest-evidence" && idea.year > eventYear) {
        problems.push(`${eat}: the idea is placed at ${idea.year}, after this earliest evidence of it (${eventYear}); place it at or before its earliest evidence`);
      }
      if (em.source_key && !ctx.sourceExists(em.source_key)) problems.push(`${eat}: no source with key "${em.source_key}" (use null if it isn't in the graph)`);
      if (em.evidence.split(/\s+/).length > 45) problems.push(`${eat}: evidence is longer than 40 words`);
      const doc = ctx.evidence.locate(em.evidence, em.evidence_url);
      if (!doc) problems.push(`${eat}: the excerpt was not found in any document read during this run; quote exactly (use search_source to confirm)`);
      else if (disallowedEvidence(doc.finalUrl)) problems.push(`${eat}: ${disallowedEvidence(doc.finalUrl)}`);
    }
  });

  const without = new Set<string>();
  for (const w of x.events_without_ideas) {
    if (!ctx.events.has(w.event_id)) problems.push(`events_without_ideas: "${w.event_id}" is not one of this period's events`);
    if (covered.has(w.event_id)) problems.push(`events_without_ideas: "${w.event_id}" also has an emergence; list it in one place`);
    without.add(w.event_id);
  }
  for (const id of ctx.events.keys()) {
    if (!covered.has(id) && !without.has(id)) problems.push(`event "${id}" is neither in an emergence nor in events_without_ideas`);
  }
  return problems;
}

export function createSubmitInterpretationTool(ctx: InterpretContext, onAccept: (x: Interpretation) => void, onGiveUp: (problems: string[]) => void) {
  let rejections = 0;
  let accepted = false;
  return defineTool({
    name: "submit_interpretation",
    description:
      "Submit the ideas you identified from the period's events, with the evidence for each emergence, and the events that show no idea. " +
      "Call this once, when you're done. The harness checks every excerpt against the documents you read, that ids exist, and that every event " +
      "is accounted for; if anything fails you get the list of problems and must fix them and submit again.",
    input: InterpretationSchema,
    strict: true,
    async run(interpretation) {
      if (accepted) throw new ToolError("An interpretation has already been accepted for this run.");
      const problems = checkInterpretation(interpretation, ctx);
      if (problems.length) {
        if (++rejections > MAX_REJECTIONS) {
          onGiveUp(problems);
          throw new ToolError(`Rejected too many times; this run ends without saving.\n- ${problems.join("\n- ")}`);
        }
        throw new ToolError(`Submission rejected (${rejections}/${MAX_REJECTIONS}). Fix these and submit again:\n- ${problems.join("\n- ")}`);
      }
      accepted = true;
      onAccept(interpretation);
      return "Interpretation accepted. You are done; reply with a one-line summary.";
    },
  });
}
