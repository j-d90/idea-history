// Harvest events from documents the finder stored. Usage:
//   npm run harvest -- [<source-key>...] [--limit <n>] [--batch] [--dry-run]
// With no keys, harvests pending sources (all of them, or --limit). --batch sends
// every request through the Batch API at half price and waits for it to finish.
import { parseArgs } from "node:util";
import { pendingHarvests } from "../../kg/src/repository.ts";
import { openRuntime, withRead } from "../core/runtime.ts";
import { harvestSources, type HarvestResult } from "./harvest.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { limit: { type: "string" }, batch: { type: "boolean", default: false }, "dry-run": { type: "boolean", default: false } },
});

const rt = await openRuntime();
let results: HarvestResult[] = [];
try {
  const keys = positionals.length ? positionals : await withRead(rt.driver, (tx) => pendingHarvests(tx, values.limit ? Number(values.limit) : undefined));
  if (!keys.length) console.log("No sources waiting to be harvested (find some with npm run find).");
  else {
    console.error(`Harvesting ${keys.length} source(s) with ${rt.config.harvestModel}${values.batch ? " (batch, half price)" : ""}${values["dry-run"] ? " (dry run)" : ""}`);
    results = await harvestSources(keys, rt, { batch: values.batch, dryRun: values["dry-run"] });
  }
} finally {
  await rt.close();
}

let cost = 0;
for (const r of results) {
  cost += r.costUsd;
  console.log(`${r.key}: ${r.status.toUpperCase()}, ${r.created} new, ${r.merged} merged, ${r.rejected} rejected ($${r.costUsd.toFixed(3)})${r.note ? ` (${r.note})` : ""}`);
}
const created = results.reduce((n, r) => n + r.created, 0);
if (results.length) console.log(`${created} new event(s) for $${cost.toFixed(3)}${created ? ` ($${(cost / created).toFixed(4)} per event)` : ""}`);
