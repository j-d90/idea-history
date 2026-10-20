import { z } from "zod/v4";
import { linkTypes } from "../../src/content/schema.ts";
import type { EvidenceLedger } from "../core/evidence.ts";
import { disallowedEvidence } from "../core/policy.ts";
import { defineTool, ToolError } from "../core/tools/types.ts";

// The linker's structured output and the harness checks applied to it.

const ProposedLink = z.strictObject({
  target_id: z.string().describe("The earlier idea"),
  type: z.enum(linkTypes),
  why: z.string().describe("One sentence"),
  evidence: z.string().describe("Verbatim excerpt (at most 40 words) establishing the relationship"),
  evidence_url: z.string().describe("URL of the document the excerpt comes from, as you read it"),
  source_key: z.string().nullable().describe("Bibliography key, if the document is a source already in the graph"),
  locator: z.string().nullable().describe("Printed page or section"),
  confidence: z.enum(["low", "medium", "high"]),
});

export const LinkSubmissionSchema = z.strictObject({
  links: z.array(ProposedLink),
  considered: z.array(z.strictObject({ target_id: z.string(), reason: z.string().describe("Why there is no link") })),
});

export type LinkSubmission = z.infer<typeof LinkSubmissionSchema>;

export interface LinkContext {
  ideaId: string;
  ideaYear: number;
  evidence: EvidenceLedger;
  /** Every candidate and seed target the agent was given; each must be accounted for. */
  mustConsider: string[];
  /** Year and status of any idea id, or undefined if it doesn't exist. */
  lookup: (id: string) => { year: number; status: string } | undefined;
  sourceExists: (key: string) => boolean;
}

const MAX_REJECTIONS = 3;

export function checkLinks(s: LinkSubmission, ctx: LinkContext): string[] {
  const problems: string[] = [];
  const linked = new Set<string>();

  for (const l of s.links) {
    const at = `link to "${l.target_id}"`;
    if (linked.has(l.target_id)) problems.push(`${at}: listed twice (choose one type)`);
    linked.add(l.target_id);
    const target = ctx.lookup(l.target_id);
    if (l.target_id === ctx.ideaId) problems.push(`${at}: an idea cannot link to itself`);
    else if (!target) problems.push(`${at}: no idea with that id`);
    else {
      if (target.status === "candidate") problems.push(`${at}: candidate ideas can't be linked until curated`);
      if (target.year > ctx.ideaYear) problems.push(`${at}: the target is later (${target.year}) than this idea (${ctx.ideaYear}); links go from the later idea to the earlier one`);
    }
    if (l.source_key && !ctx.sourceExists(l.source_key)) problems.push(`${at}: no source with key "${l.source_key}" (use null if it isn't in the graph)`);
    if (l.evidence.split(/\s+/).length > 45) problems.push(`${at}: evidence is longer than 40 words`);
    const doc = ctx.evidence.locate(l.evidence, l.evidence_url);
    if (!doc) problems.push(`${at}: the excerpt was not found in any document read during this run; quote exactly (use search_source to confirm)`);
    else if (disallowedEvidence(doc.finalUrl)) problems.push(`${at}: ${disallowedEvidence(doc.finalUrl)}`);
  }

  const considered = new Set(s.considered.map((c) => c.target_id));
  for (const id of ctx.mustConsider) {
    if (!linked.has(id) && !considered.has(id)) problems.push(`"${id}" was given to you but is neither linked nor in considered`);
  }
  for (const id of considered) if (linked.has(id)) problems.push(`"${id}" is both linked and in considered`);
  return problems;
}

export function createSubmitLinksTool(ctx: LinkContext, onAccept: (s: LinkSubmission) => void, onGiveUp: (problems: string[]) => void) {
  let rejections = 0;
  let accepted = false;
  return defineTool({
    name: "submit_links",
    description:
      "Submit the links you found (and the candidates you considered and rejected). Call this once, when you're done. The harness checks " +
      "every excerpt against the documents you read, that targets exist and are earlier, and that every candidate you were given is accounted " +
      "for; if anything fails you get the list of problems and must fix them and submit again.",
    input: LinkSubmissionSchema,
    strict: true,
    async run(submission) {
      if (accepted) throw new ToolError("Links have already been accepted for this run.");
      const problems = checkLinks(submission, ctx);
      if (problems.length) {
        if (++rejections > MAX_REJECTIONS) {
          onGiveUp(problems);
          throw new ToolError(`Rejected too many times; this run ends without saving.\n- ${problems.join("\n- ")}`);
        }
        throw new ToolError(`Submission rejected (${rejections}/${MAX_REJECTIONS}). Fix these and submit again:\n- ${problems.join("\n- ")}`);
      }
      accepted = true;
      onAccept(submission);
      return "Links accepted. You are done; reply with a one-line summary.";
    },
  });
}
