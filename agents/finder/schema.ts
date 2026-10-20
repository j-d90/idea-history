import { z } from "zod/v4";
import { ProposedSource } from "../core/sources.ts";
import { defineTool, ToolError } from "../core/tools/types.ts";

// The finder's structured output: documents to harvest. The harness, not the
// agent, decides which are kept (readable, allowed, not already in the graph).

export const FoundSource = z.strictObject({
  ...ProposedSource.shape,
  url: z.string().describe("Direct URL of the document's full text (HTML page or PDF), not a landing page"),
  covers: z.string().describe("What dated events it lists or discusses, in a sentence"),
});

export type FoundSource = z.infer<typeof FoundSource>;

export const FindSubmissionSchema = z.strictObject({
  sources: z.array(FoundSource),
  notes: z.string().describe("Gaps: regions or kinds of events you couldn't find good documents for"),
});

export type FindSubmission = z.infer<typeof FindSubmissionSchema>;

export const MAX_FOUND = 20;

/** The submit tool. `onSubmit` returns the message for the agent and whether the run is done. */
export function createSubmitSourcesTool(onSubmit: (s: FindSubmission) => Promise<{ message: string; done: boolean }>) {
  let done = false;
  return defineTool({
    name: "submit_sources",
    description:
      "Submit the documents you found for harvesting. The harness fetches each document to check it's readable and allowed, skips ones " +
      "already in the graph, and stores the rest; it tells you what it kept, and asks for more if too few were usable.",
    input: FindSubmissionSchema,
    strict: true,
    async run(submission) {
      if (done) throw new ToolError("Sources have already been accepted for this run.");
      if (submission.sources.length > MAX_FOUND) throw new ToolError(`At most ${MAX_FOUND} documents per submission; keep the richest.`);
      const r = await onSubmit(submission);
      done = r.done;
      return r.message;
    },
  });
}
