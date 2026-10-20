// Find documents to harvest for a period. Usage:
//   npm run find -- --from <year> --to <year> [--dry-run]
// Years are negative for BCE, or written like 2500bce.
import { parseArgs } from "node:util";
import { joinNegativeValues, parseYear } from "../core/args.ts";
import { openRuntime } from "../core/runtime.ts";
import { findSources, type FindResult } from "./find.ts";

const { values } = parseArgs({
  args: joinNegativeValues(process.argv.slice(2), ["--from", "--to"]),
  options: { from: { type: "string" }, to: { type: "string" }, "dry-run": { type: "boolean", default: false } },
});
const from = parseYear(values.from);
const to = parseYear(values.to);
if (from === undefined || to === undefined) {
  console.log("usage: npm run find -- --from <year> --to <year> [--dry-run]");
  process.exit(1);
}

const rt = await openRuntime();
let r: FindResult;
try {
  console.error(`Finding sources from ${from} to ${to} (${rt.config.model}${values["dry-run"] ? ", dry run" : ""})`);
  r = await findSources({ from, to }, rt, { dryRun: values["dry-run"] });
} finally {
  await rt.close();
}
console.log(`${r.status.toUpperCase()} ($${r.costUsd.toFixed(2)}, run ${r.runId})${r.reason ? ` (${r.reason})` : ""}`);
console.log(`  kept for harvesting: ${r.kept.join(", ") || "none"}`);
for (const d of r.dropped) console.log(`  dropped ${d.url}: ${d.reason}`);
process.exit(r.status === "incomplete" ? 1 : 0);
