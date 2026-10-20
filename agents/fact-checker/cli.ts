// Run the fact-checker. Usage:
//   npm run review -- <idea-id | event:event-id>... [--dry-run] [--force]
// Exit codes: 0 all passed or skipped, 2 at least one failed review, 1 error or incomplete run.
import { parseArgs } from "node:util";
import { openRuntime } from "../core/runtime.ts";
import { reviewEntry, type ReviewResult } from "./review.ts";
import { parseTarget } from "./types.ts";

const { values, positionals: ids } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});
if (!ids.length) {
  console.log("usage: npm run review -- <idea-id | event:event-id>... [--dry-run] [--force]");
  process.exit(1);
}

const rt = await openRuntime();
const results: ReviewResult[] = [];
try {
  for (const arg of ids) {
    const { label, id } = parseTarget(arg);
    console.error(`Reviewing ${arg} (${rt.config.model}, effort ${rt.config.effort}${values["dry-run"] ? ", dry run" : ""})`);
    try {
      results.push(await reviewEntry(label, id, rt, { dryRun: values["dry-run"], force: values.force }));
    } catch (e) {
      if (rt.signal.aborted) break;
      results.push({ status: "incomplete", id: arg, runId: "-", reason: (e as Error).message, costUsd: 0 });
    }
  }
} finally {
  await rt.close();
}

for (const r of results) {
  if (r.status === "skipped") console.log(`${r.id}: SKIPPED (${r.reason})`);
  else if (r.status === "incomplete") console.log(`${r.id}: INCOMPLETE (${r.reason})`);
  else {
    console.log(`${r.id}: ${r.status.toUpperCase()} ($${r.costUsd.toFixed(2)}, run ${r.runId})${r.reportPath ? ` → ${r.reportPath}` : ""}`);
    for (const b of r.blocking) console.log(`  - ${b}`);
  }
}
process.exit(results.some((r) => r.status === "incomplete") || rt.signal.aborted ? 1 : results.some((r) => r.status === "fail") ? 2 : 0);
