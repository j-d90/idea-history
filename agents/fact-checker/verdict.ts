import { z } from "zod/v4";
import type { EvidenceLedger } from "../core/evidence.ts";
import { disallowedEvidence } from "../core/policy.ts";
import { defineTool, ToolError } from "../core/tools/types.ts";
import type { ReviewSubject } from "./types.ts";

// The agent's only output is a structured verdict submitted through the
// submit_review tool. The harness checks it deterministically before accepting
// it, and the final pass/fail is computed from it by code (decide()), never
// taken from the model's say-so alone.

export const CLAIM_VERDICTS = ["supported", "overstated", "unsupported", "contradicted", "unverifiable", "miscited"] as const;
const LOCATIONS = ["title", "origin", "summary", "date", "body"] as const;

// Strict tool schemas allow no numeric or length constraints, and every field is
// required (optional values are nullable instead).
export const SubmissionSchema = z.strictObject({
  verdict: z.enum(["pass", "fail"]),
  summary: z.string().describe("One or two sentences explaining the verdict"),
  sources: z
    .array(
      z.strictObject({
        key: z.string().describe("Bibliography key"),
        accessed: z.boolean().describe("Whether you read the work itself (not just metadata)"),
        how: z.string().describe("How you accessed it: URL read, API, archive snapshot, or why you could not"),
        bibliographic_details_correct: z.boolean(),
        notes: z.string(),
      }),
    )
    .describe("One entry per source the idea cites"),
  claims: z.array(
    z.strictObject({
      id: z.number().describe("1, 2, 3, ..."),
      text: z.string().describe("The claim, as stated in the entry"),
      location: z.enum(LOCATIONS),
      source_key: z.string().nullable().describe("The bibliography key whose text you checked the claim against"),
      locator: z.string().nullable().describe("Printed page, section or paragraph where the evidence is"),
      evidence: z
        .string()
        .nullable()
        .describe("Verbatim excerpt (at most 30 words) from a document you read with the tools; '…' may mark omitted words. Required for 'supported'."),
      evidence_url: z.string().nullable().describe("URL of the document the excerpt comes from, as you read it"),
      verdict: z.enum(CLAIM_VERDICTS),
      note: z.string().describe("Why this verdict; for anything but 'supported', what is wrong"),
    }),
  ),
  checks: z.strictObject({
    summary_and_title: z.string(),
    date: z.string(),
    attribution_and_framing: z.string(),
    disagreement_searches: z.array(z.strictObject({ query: z.string(), finding: z.string() })),
  }),
  blocking_issues: z.array(z.string()).describe("Each says exactly what must change. Empty only if passing."),
  suggestions: z.array(z.string()).describe("Non-blocking improvements"),
});

export type Submission = z.infer<typeof SubmissionSchema>;

/** Which document each supported claim's excerpt was found in. */
export type VerifiedEvidence = Map<number, string>;

export interface AcceptedSubmission {
  submission: Submission;
  verified: VerifiedEvidence;
  /** Problems the agent failed to fix after repeated rejections; any of these forces a fail. */
  unresolved: string[];
}

const MAX_REJECTIONS = 3;

/**
 * The submit_review tool. Rejected submissions return an error listing every
 * problem so the agent can correct them; after MAX_REJECTIONS the submission is
 * accepted as-is and the remaining problems force a fail.
 */
export function createSubmitTool(subject: ReviewSubject, evidence: EvidenceLedger, onAccept: (a: AcceptedSubmission) => void) {
  let rejections = 0;
  let accepted = false;

  return defineTool({
    name: "submit_review",
    description:
      "Submit your finished review. Call this exactly once, when you have checked every claim against the sources. " +
      "The harness verifies that every 'supported' claim's excerpt appears verbatim in a document you read with read_source, " +
      "search_source or an API tool, that every source and claim location is covered, and that the verdict is consistent; " +
      "if anything fails, you get the list of problems and must fix them and submit again.",
    input: SubmissionSchema,
    strict: true,
    async run(submission) {
      if (accepted) throw new ToolError("A review has already been accepted for this run.");
      const { problems, verified } = checkSubmission(submission, subject, evidence);

      if (problems.length && ++rejections <= MAX_REJECTIONS) {
        throw new ToolError(
          `Submission rejected (${rejections}/${MAX_REJECTIONS}). Fix these and submit again:\n` + problems.map((p) => `- ${p}`).join("\n"),
        );
      }
      accepted = true;
      onAccept({ submission, verified, unresolved: problems });
      return problems.length
        ? "Accepted with unresolved problems; the review will be recorded as a fail. You are done."
        : "Review accepted. You are done; reply with a one-line summary.";
    },
  });
}

export function checkSubmission(s: Submission, subject: ReviewSubject, evidence: EvidenceLedger) {
  const problems: string[] = [];
  const verified: VerifiedEvidence = new Map();
  const { idea } = subject;
  const keys = new Set(Object.keys(subject.sources));

  // Every cited source assessed, nothing invented.
  const assessed = s.sources.map((x) => x.key);
  for (const k of keys) if (!assessed.includes(k)) problems.push(`sources: no assessment for "${k}"`);
  for (const k of assessed) if (!keys.has(k)) problems.push(`sources: "${k}" is not one of this idea's sources`);
  if (new Set(assessed).size !== assessed.length) problems.push("sources: a key is assessed more than once");

  // Every part of the entry has claims.
  const ids = s.claims.map((c) => c.id);
  if (new Set(ids).size !== ids.length) problems.push("claims: ids must be unique");
  const required: (typeof LOCATIONS)[number][] = ["title", "origin", "summary", "date"];
  if (idea.body.trim()) required.push("body");
  for (const loc of required) {
    if (!s.claims.some((c) => c.location === loc)) problems.push(`claims: nothing listed for the ${loc}`);
  }

  // Supported claims need real, verbatim evidence from a document the agent read.
  for (const c of s.claims) {
    if (c.source_key && !keys.has(c.source_key)) problems.push(`claim ${c.id}: "${c.source_key}" is not one of this idea's sources`);
    if (c.verdict !== "supported") continue;
    if (!c.source_key) problems.push(`claim ${c.id}: a supported claim needs a source_key`);
    if (!c.evidence) {
      problems.push(`claim ${c.id}: a supported claim needs a verbatim evidence excerpt`);
      continue;
    }
    const doc = evidence.locate(c.evidence, c.evidence_url);
    if (doc && disallowedEvidence(doc.finalUrl)) problems.push(`claim ${c.id}: ${disallowedEvidence(doc.finalUrl)}`);
    else if (doc) verified.set(c.id, doc.finalUrl);
    else {
      problems.push(
        `claim ${c.id}: the excerpt was not found in any document read during this review. ` +
          `Quote the source exactly (use search_source to confirm), or change the verdict.`,
      );
    }
  }

  // The verdict must follow from the claims.
  const notSupported = s.claims.filter((c) => c.verdict !== "supported");
  if (s.verdict === "pass" && notSupported.length) {
    problems.push(`verdict: "pass" with claims not supported (${notSupported.map((c) => c.id).join(", ")}); fix the claims or fail the review`);
  }
  if (s.verdict === "pass" && s.blocking_issues.length) problems.push('verdict: "pass" with blocking issues listed');
  if (s.verdict === "fail" && !s.blocking_issues.length) problems.push('verdict: "fail" needs at least one blocking issue');

  return { problems, verified };
}

/** The final decision, computed by code. A model "pass" is necessary, never sufficient. */
export function decide(a: AcceptedSubmission): { verdict: "pass" | "fail"; reasons: string[] } {
  const reasons = [...a.unresolved];
  const s = a.submission;
  if (s.verdict !== "pass") reasons.push("the reviewer failed the entry");
  if (s.claims.some((c) => c.verdict !== "supported")) reasons.push("not every claim is supported");
  if (s.claims.some((c) => c.verdict === "supported" && !a.verified.has(c.id))) reasons.push("unverified evidence");
  if (s.blocking_issues.length) reasons.push("blocking issues remain");
  return { verdict: reasons.length ? "fail" : "pass", reasons: [...new Set(reasons)] };
}
