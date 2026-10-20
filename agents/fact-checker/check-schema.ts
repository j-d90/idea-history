import { z } from "zod/v4";
import { defineTool, ToolError } from "../core/tools/types.ts";

// The batch check's structured output. The harness has already re-verified each
// entry's quoted excerpts against its sources; the agent judges whether the
// entry's claims stay within them. Pass or fail is decided by code from this.

export const CHECK_FIELDS = ["title", "place", "summary", "date", "body"] as const;

export const CheckSubmissionSchema = z.strictObject({
  results: z.array(
    z.strictObject({
      event_id: z.string(),
      verdict: z.enum(["pass", "fail"]),
      issues: z
        .array(z.strictObject({ field: z.enum(CHECK_FIELDS), problem: z.string().describe("What the entry says that the excerpts don't support, and what to change") }))
        .describe("Empty for a pass; at least one for a fail"),
    }),
  ),
});

export type CheckSubmission = z.infer<typeof CheckSubmissionSchema>;
export type CheckResult = CheckSubmission["results"][number];

const MAX_REJECTIONS = 3;

export function checkCheckSubmission(s: CheckSubmission, ids: string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of s.results) {
    if (!ids.includes(r.event_id)) problems.push(`"${r.event_id}" isn't one of the entries you were given`);
    if (seen.has(r.event_id)) problems.push(`"${r.event_id}" is listed twice`);
    seen.add(r.event_id);
    if (r.verdict === "pass" && r.issues.length) problems.push(`"${r.event_id}": a pass can't list issues; fail it, or remove the issues`);
    if (r.verdict === "fail" && !r.issues.length) problems.push(`"${r.event_id}": a fail needs at least one issue`);
  }
  for (const id of ids) if (!seen.has(id)) problems.push(`no result for "${id}"`);
  return problems;
}

export function createSubmitCheckTool(ids: string[], onAccept: (s: CheckSubmission) => void, onGiveUp: (problems: string[]) => void) {
  let rejections = 0;
  let accepted = false;
  return defineTool({
    name: "submit_check",
    description:
      "Submit one result per entry: pass if every claim stays within its excerpts, otherwise fail with the issues. Call this once. " +
      "If the submission is malformed you get the list of problems and must fix them and submit again.",
    input: CheckSubmissionSchema,
    strict: true,
    async run(submission) {
      if (accepted) throw new ToolError("A check has already been accepted for this run.");
      const problems = checkCheckSubmission(submission, ids);
      if (problems.length) {
        if (++rejections > MAX_REJECTIONS) {
          onGiveUp(problems);
          throw new ToolError(`Rejected too many times; nothing is recorded.\n- ${problems.join("\n- ")}`);
        }
        throw new ToolError(`Submission rejected (${rejections}/${MAX_REJECTIONS}). Fix these and submit again:\n- ${problems.join("\n- ")}`);
      }
      accepted = true;
      onAccept(submission);
      return "Check accepted. You are done.";
    },
  });
}
