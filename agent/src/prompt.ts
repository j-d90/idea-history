import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { ReviewSubject } from "./store/types.ts";

const PROMPT_PATH = join(import.meta.dirname, "..", "prompts", "fact-checker.md");

/** The system prompt is fixed across runs (no dates or ids), so it stays cacheable. */
export function systemPrompt(): string {
  return readFileSync(PROMPT_PATH, "utf8");
}

/** The task: the entry under review and the bibliography entries it cites. */
export function taskPrompt(subject: ReviewSubject, today: string): string {
  const { id, body, status: _s, review: _r, ...fields } = subject.idea;
  return [
    `Review the entry "${id}". Today is ${today}.`,
    "",
    `<entry id="${id}">`,
    stringify(fields, { lineWidth: 0 }).trimEnd(),
    "---",
    body,
    "</entry>",
    "",
    "<bibliography>",
    stringify(subject.sources, { lineWidth: 0 }).trimEnd(),
    "</bibliography>",
    "",
    "Check every claim against the sources, then call submit_review.",
  ].join("\n");
}

export const NUDGE =
  "You ended your turn without submitting. If you have finished checking, call submit_review now; " +
  "if not, continue checking with the tools. A review is recorded only through submit_review.";
