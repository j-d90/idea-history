// Run the extractor on one or more sources. Usage:
//   npm run extract -- <source-key>... [--dry-run] [--focus "<what to look for>"]
import { parseArgs } from "node:util";
import { openRuntime } from "../core/runtime.ts";
import { extractFromSource, type ExtractResult } from "./extract.ts";

const { values, positionals: keys } = parseArgs({
  allowPositionals: true,
  options: { "dry-run": { type: "boolean", default: false }, focus: { type: "string" } },
});
if (!keys.length) {
  console.log('usage: npm run extract -- <source-key>... [--dry-run] [--focus "<what to look for>"]');
  process.exit(1);
}

const rt = await openRuntime();
const results: ExtractResult[] = [];
try {
  for (const key of keys) {
    console.error(`Extracting from ${key} (${rt.config.model}${values["dry-run"] ? ", dry run" : ""})`);
    try {
      results.push(await extractFromSource(key, rt, { dryRun: values["dry-run"], focus: values.focus }));
    } catch (e) {
      if (rt.signal.aborted) break;
      results.push({ status: "incomplete", sourceKey: key, runId: "-", costUsd: 0, matched: [], created: [], entities: 0, reason: (e as Error).message });
    }
  }
} finally {
  await rt.close();
}

for (const r of results) {
  if (r.status === "incomplete") console.log(`${r.sourceKey}: INCOMPLETE (${r.reason})`);
  else {
    console.log(`${r.sourceKey}: ${r.status === "dry-run" ? "DRY RUN" : "SAVED"} ($${r.costUsd.toFixed(2)}, run ${r.runId})`);
    console.log(`  matched existing: ${r.matched.join(", ") || "none"}`);
    console.log(`  new candidates:   ${r.created.join(", ") || "none"}`);
    console.log(`  new entities:     ${r.entities}`);
  }
}
process.exit(results.some((r) => r.status === "incomplete") ? 1 : 0);
