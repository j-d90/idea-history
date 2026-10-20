// Run the fact-checker. Usage:
//   npm run review -- <idea-id>... [--dry-run] [--force] [--store files|graph]
// Exit codes: 0 all passed or skipped, 2 at least one failed review, 1 error or incomplete run.
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config.ts";
import { reviewIdea, type ReviewResult } from "./reviewer.ts";
import { FileReviewStore } from "./store/files.ts";
import type { ReviewStore } from "./store/types.ts";

const { values, positionals: ids } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    store: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || ids.length === 0) {
  console.log("usage: npm run review -- <idea-id>... [--dry-run] [--force] [--store files|graph]");
  process.exit(ids.length ? 0 : 1);
}

const config = loadConfig({ ...process.env, ...(values.store ? { REVIEW_STORE: values.store } : {}) });

async function openStore(): Promise<ReviewStore> {
  if (config.store === "files") return new FileReviewStore();
  // Loaded lazily so the files store works without Neo4j installed or running.
  const { GraphReviewStore } = await import("../../kg/src/graph-store.ts");
  return GraphReviewStore.connect(config.neo4j);
}

// Ctrl-C aborts in-flight requests and tool calls; nothing is recorded for an aborted run.
const controller = new AbortController();
process.once("SIGINT", () => {
  console.error("\nAborting…");
  controller.abort();
});

const client = new Anthropic({ maxRetries: 4 });
const store = await openStore();
const results: ReviewResult[] = [];

try {
  for (const id of ids) {
    console.error(`Reviewing ${id} (${config.model}, effort ${config.effort}, store ${store.name}${values["dry-run"] ? ", dry run" : ""})`);
    try {
      results.push(await reviewIdea(id, { client, config, store, signal: controller.signal }, { dryRun: values["dry-run"], force: values.force }));
    } catch (e) {
      if (controller.signal.aborted) break;
      results.push({ status: "incomplete", id, runId: "-", reason: (e as Error).message, costUsd: 0 });
    }
  }
} finally {
  await store.close();
}

for (const r of results) {
  if (r.status === "skipped") console.log(`${r.id}: SKIPPED (${r.reason})`);
  else if (r.status === "incomplete") console.log(`${r.id}: INCOMPLETE (${r.reason})`);
  else {
    const where = r.reportPath ? ` → ${r.reportPath}` : "";
    console.log(`${r.id}: ${r.status.toUpperCase()} ($${r.costUsd.toFixed(2)}, run ${r.runId})${where}`);
    for (const b of r.blocking) console.log(`  - ${b}`);
  }
}

process.exit(results.some((r) => r.status === "incomplete") || controller.signal.aborted ? 1 : results.some((r) => r.status === "fail") ? 2 : 0);
