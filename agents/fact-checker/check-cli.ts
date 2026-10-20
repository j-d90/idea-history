// Run the fact-checker's batch check on sourced events. Usage:
//   npm run check -- <event-id>... [--dry-run]
//   npm run check -- --from <year> --to <year> [--dry-run]     every sourced event in the range
// Years are negative for BCE, or written like 2500bce.
import { parseArgs } from "node:util";
import { loadEntries } from "../../kg/src/repository.ts";
import { joinNegativeValues, parseYear } from "../core/args.ts";
import { openRuntime, withRead } from "../core/runtime.ts";
import { CHECK_BATCH, checkable, checkEvents, type CheckOutcome } from "./check.ts";

const { values, positionals } = parseArgs({
  args: joinNegativeValues(process.argv.slice(2), ["--from", "--to"]),
  allowPositionals: true,
  options: { from: { type: "string" }, to: { type: "string" }, "dry-run": { type: "boolean", default: false } },
});
const from = parseYear(values.from);
const to = parseYear(values.to);
if (!positionals.length && (from === undefined || to === undefined)) {
  console.log("usage: npm run check -- <event-id>... | --from <year> --to <year>   [--dry-run]");
  process.exit(1);
}

const rt = await openRuntime();
const outcomes: CheckOutcome[] = [];
let cost = 0;
try {
  const ids = positionals.length
    ? positionals.map((p) => p.replace(/^event:/, ""))
    : (await withRead(rt.driver, (tx) => loadEntries(tx, "Event", { from, to }))).filter((e) => e.status === "sourced" && checkable(e)).map((e) => e.id);
  for (let i = 0; i < ids.length; i += CHECK_BATCH) {
    const batch = ids.slice(i, i + CHECK_BATCH);
    console.error(`Checking ${batch.length} event(s) (${rt.config.model}${values["dry-run"] ? ", dry run" : ""})`);
    const r = await checkEvents(batch, rt, { dryRun: values["dry-run"] });
    cost += r.costUsd;
    outcomes.push(...r.outcomes);
    if (r.status === "incomplete") console.error(`  incomplete: ${r.reason}`);
  }
} finally {
  await rt.close();
}

for (const o of outcomes) {
  console.log(`${o.id}: ${o.status.toUpperCase()}${o.reason ? ` (${o.reason})` : ""}`);
  for (const i of o.issues ?? []) console.log(`  - ${i}`);
}
console.log(`${outcomes.filter((o) => o.status === "checked").length} checked, ${outcomes.filter((o) => o.status === "failed").length} failed, ${outcomes.filter((o) => o.status === "skipped").length} skipped; $${cost.toFixed(2)}${values["dry-run"] ? " (dry run, nothing recorded)" : ""}`);
