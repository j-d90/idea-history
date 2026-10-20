// Run the linker on one or more ideas. Usage:
//   npm run link -- <idea-id>... [--dry-run]
import { parseArgs } from "node:util";
import { openRuntime } from "../core/runtime.ts";
import { linkIdea, type LinkResult } from "./link.ts";

const { values, positionals: ids } = parseArgs({ allowPositionals: true, options: { "dry-run": { type: "boolean", default: false } } });
if (!ids.length) {
  console.log("usage: npm run link -- <idea-id>... [--dry-run]");
  process.exit(1);
}

const rt = await openRuntime();
const results: LinkResult[] = [];
try {
  for (const id of ids) {
    console.error(`Linking ${id} (${rt.config.model}${values["dry-run"] ? ", dry run" : ""})`);
    try {
      results.push(await linkIdea(id, rt, { dryRun: values["dry-run"] }));
    } catch (e) {
      if (rt.signal.aborted) break;
      results.push({ status: "incomplete", ideaId: id, runId: "-", costUsd: 0, links: [], removedSeeds: 0, reason: (e as Error).message });
    }
  }
} finally {
  await rt.close();
}

for (const r of results) {
  if (r.status === "incomplete" || r.status === "skipped") console.log(`${r.ideaId}: ${r.status.toUpperCase()} (${r.reason})`);
  else {
    console.log(`${r.ideaId}: ${r.status === "dry-run" ? "DRY RUN" : "SAVED"} ($${r.costUsd.toFixed(2)}, run ${r.runId}); ${r.removedSeeds} unverified seed link(s) ${r.status === "dry-run" ? "would be removed" : "removed"}`);
    for (const l of r.links) console.log(`  -${l.type}-> ${l.to} [${l.confidence}] ${l.why ?? ""}`);
    if (!r.links.length) console.log("  no links");
  }
}
process.exit(results.some((r) => r.status === "incomplete") ? 1 : 0);
