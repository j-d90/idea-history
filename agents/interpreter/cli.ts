// Run the interpreter on the events of a period. Usage:
//   npm run interpret -- --from <year> --to <year> [--dry-run]
// Years are negative for BCE, or written like 2500bce.
import { parseArgs } from "node:util";
import { joinNegativeValues, parseYear } from "../core/args.ts";
import { openRuntime } from "../core/runtime.ts";
import { interpretPeriod, type InterpretResult } from "./interpret.ts";

const { values } = parseArgs({
  args: joinNegativeValues(process.argv.slice(2), ["--from", "--to"]),
  options: { from: { type: "string" }, to: { type: "string" }, "dry-run": { type: "boolean", default: false } },
});
const from = parseYear(values.from);
const to = parseYear(values.to);
if (from === undefined || to === undefined) {
  console.log("usage: npm run interpret -- --from <year> --to <year> [--dry-run]");
  process.exit(1);
}

const rt = await openRuntime();
let r: InterpretResult;
try {
  console.error(`Interpreting events from ${from} to ${to} (${rt.config.model}${values["dry-run"] ? ", dry run" : ""})`);
  r = await interpretPeriod({ from, to }, rt, { dryRun: values["dry-run"] });
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
} finally {
  await rt.close();
}

if (r.status === "incomplete" || r.status === "skipped") {
  console.log(`${r.status.toUpperCase()} (${r.reason})`);
  process.exit(r.status === "incomplete" ? 1 : 0);
}
console.log(`${r.status === "dry-run" ? "DRY RUN" : "SAVED"} ($${r.costUsd.toFixed(2)}, run ${r.runId})`);
console.log(`  existing ideas: ${r.matched.join(", ") || "none"}`);
console.log(`  new candidates: ${r.created.join(", ") || "none"}`);
console.log(`  emergences: ${r.emergences}`);
