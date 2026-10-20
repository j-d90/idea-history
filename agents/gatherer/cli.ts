// Run the gatherer for one observation type and period. Usage:
//   npm run gather -- <type> --from <year> --to <year> [--focus "<what to look for>"] [--searches <n>] [--dry-run]
// Years are negative for BCE, or written like 2500bce. Types: events.
import { parseArgs } from "node:util";
import { joinNegativeValues, parseYear } from "../core/args.ts";
import { openRuntime } from "../core/runtime.ts";
import { gather, observationTypes, type GatherResult } from "./gather.ts";

const USAGE = 'usage: npm run gather -- <type> --from <year> --to <year> [--focus "<what to look for>"] [--searches <n>] [--dry-run]';
const { values, positionals } = parseArgs({
  args: joinNegativeValues(process.argv.slice(2), ["--from", "--to"]),
  allowPositionals: true,
  options: {
    from: { type: "string" },
    to: { type: "string" },
    focus: { type: "string" },
    searches: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
const type = observationTypes[positionals[0] ?? ""];
const from = parseYear(values.from);
const to = parseYear(values.to);
if (!type || from === undefined || to === undefined) {
  console.log(`${USAGE}\ntypes: ${Object.keys(observationTypes).join(", ")}`);
  process.exit(1);
}

const rt = await openRuntime();
let result: GatherResult;
try {
  console.error(`Gathering ${type.name} from ${from} to ${to} (${rt.config.model}${values["dry-run"] ? ", dry run" : ""})`);
  result = await gather(type, { from, to }, rt, {
    dryRun: values["dry-run"],
    focus: values.focus,
    maxSearches: values.searches ? Number(values.searches) : undefined,
  });
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
} finally {
  await rt.close();
}

const r = result;
if (r.status === "incomplete") {
  console.log(`INCOMPLETE (${r.reason}; $${r.costUsd.toFixed(2)}, run ${r.runId})`);
  process.exit(1);
}
console.log(`${r.status === "dry-run" ? "DRY RUN" : "SAVED"} ($${r.costUsd.toFixed(2)}, run ${r.runId})`);
console.log(`  new ${type.name}: ${r.created.join(", ") || "none"}`);
if (r.updated.length) console.log(`  updated: ${r.updated.join(", ")}`);
console.log(`  new sources: ${r.sources.join(", ") || "none"}`);
console.log(`  new entities: ${r.entities}; omitted: ${r.omitted}`);
if (r.coverage) console.log(`  coverage: ${r.coverage}`);
