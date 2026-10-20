import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const runsDir = join(import.meta.dirname, "..", "..", ".runs");

/**
 * The audit trail for one review: every request, response (including thinking
 * summaries), tool call and result, appended as JSON lines to .runs/<runId>.jsonl.
 * Progress lines go to stderr so stdout stays clean for the final summary.
 */
export class RunLog {
  readonly path: string;

  constructor(runId: string) {
    mkdirSync(runsDir, { recursive: true });
    this.path = join(runsDir, `${runId}.jsonl`);
  }

  event(type: string, data: Record<string, unknown> = {}): void {
    appendFileSync(this.path, JSON.stringify({ t: new Date().toISOString(), type, ...data }) + "\n");
  }

  progress(message: string): void {
    process.stderr.write(`  ${message}\n`);
  }
}

/** Shorten long strings for logs and progress lines. */
export function clip(s: string, max = 20_000): string {
  return s.length > max ? `${s.slice(0, max)}… [${s.length - max} more characters]` : s;
}
