// Run the author on ideas or events. Usage:
//   npm run author -- <idea-id | event:event-id>... [--dry-run] [--force] [--light]
// Candidates are curated (written or declined), drafts are sourced, and sourced
// entries whose latest review failed are revised. --force rewrites a sourced entry.
// --light revises without research, within the entry's existing excerpts (after a failed check).
import { parseArgs } from "node:util";
import { openRuntime } from "../core/runtime.ts";
import { parseTarget } from "../fact-checker/types.ts";
import { authorEntry, type AuthorResult } from "./author.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "dry-run": { type: "boolean", default: false }, force: { type: "boolean", default: false }, light: { type: "boolean", default: false } },
});
if (!positionals.length) {
  console.log("usage: npm run author -- <idea-id | event:event-id>... [--dry-run] [--force]");
  process.exit(1);
}

const rt = await openRuntime();
const results: AuthorResult[] = [];
try {
  for (const arg of positionals) {
    const { label, id } = parseTarget(arg);
    console.error(`Authoring ${arg} (${rt.config.model}${values["dry-run"] ? ", dry run" : ""})`);
    try {
      results.push(await authorEntry(label, id, rt, { dryRun: values["dry-run"], force: values.force, light: values.light }));
    } catch (e) {
      if (rt.signal.aborted) break;
      results.push({ status: "incomplete", label, id, runId: "-", costUsd: 0, reason: (e as Error).message });
    }
  }
} finally {
  await rt.close();
}

for (const r of results) {
  const head = `${r.label === "Event" ? "event:" : ""}${r.id}: ${r.status.toUpperCase()}`;
  if (r.status === "skipped" || r.status === "incomplete") console.log(`${head} (${r.reason})`);
  else {
    console.log(`${head} ($${r.costUsd.toFixed(2)}, run ${r.runId})`);
    if (r.reason) console.log(`  ${r.reason}`);
    if (r.sources?.length) console.log(`  sources: ${r.sources.join(", ")}`);
  }
}
process.exit(results.some((r) => r.status === "incomplete") ? 1 : 0);
