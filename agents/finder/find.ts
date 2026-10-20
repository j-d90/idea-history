import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSources, putSource, setHarvest, sourceUrls } from "../../kg/src/repository.ts";
import { runAgentLoop } from "../core/loop.ts";
import { periodSlug, type Period } from "../core/period.ts";
import { recordAgentRun, startRun, withRead, withWrite, type Runtime } from "../core/runtime.ts";
import { checkNewSources, toSource } from "../core/sources.ts";
import { loadDocument } from "../core/tools/documents.ts";
import { fmtYear } from "../core/tools/graph.ts";
import { webSearch } from "../core/tools/index.ts";
import { searchEuropePmc } from "../core/tools/scholarly.ts";
import type { AgentTool } from "../core/tools/types.ts";
import { createSubmitSourcesTool, type FindSubmission } from "./schema.ts";

/** Documents shorter than this can't be list-like sources. */
const MIN_CHARS = 4000;
const WEB_SEARCHES = 6;
/** Fewer usable documents than this, and the agent is asked (once) to find more. */
const MIN_KEPT = 6;

export interface FindResult {
  status: "saved" | "dry-run" | "incomplete";
  period: Period;
  runId: string;
  costUsd: number;
  kept: string[];
  dropped: { url: string; reason: string }[];
  reason?: string;
}

/**
 * Find documents that list many dated events for a period:
 *   short agent run (Europe PMC first, a few web searches, no reading)
 *   → the harness fetches each proposed document, keeps the readable, allowed,
 *     new ones, and stores them as Source nodes waiting to be harvested.
 */
export async function findSources(period: Period, rt: Runtime, opts: { dryRun?: boolean } = {}): Promise<FindResult> {
  const run = startRun("finder", periodSlug(period));
  const known = await withRead(rt.driver, async (tx) => ({ urls: await sourceUrls(tx), keys: new Set(Object.keys(await loadSources(tx))) }));
  const kept: { key: string; found: FindSubmission["sources"][number] }[] = [];
  const dropped: { url: string; reason: string }[] = [];
  let submitted: FindSubmission | undefined;
  let submissions = 0;
  run.log.event("start", { period, model: rt.config.model, dryRun: !!opts.dryRun });

  const taken = new Set(known.keys);
  const submit = createSubmitSourcesTool(async (s) => {
    submissions++;
    submitted = { sources: [...(submitted?.sources ?? []), ...s.sources], notes: [submitted?.notes, s.notes].filter(Boolean).join(" ") };
    const ctx = { evidence: run.evidence, signal: rt.signal };
    await Promise.all(
      s.sources.map(async (found) => {
        if (known.urls.has(found.url)) return dropped.push({ url: found.url, reason: `already in the graph as "${known.urls.get(found.url)}"` });
        if (kept.some((k) => k.found.url === found.url)) return dropped.push({ url: found.url, reason: "submitted twice" });
        try {
          const doc = await loadDocument(found.url, ctx);
          if (doc.text.length < MIN_CHARS) return dropped.push({ url: found.url, reason: `only ${doc.text.length} characters of text; not a full document` });
        } catch (e) {
          return dropped.push({ url: found.url, reason: (e as Error).message });
        }
        // A key clash with an existing source is resolved here rather than sent back to the agent.
        let key = found.key;
        for (let n = 2; taken.has(key); n++) key = `${found.key}-${n}`;
        const problems = checkNewSources([{ ...found, key }], { evidence: run.evidence, sourceExists: () => false, today: run.today });
        if (problems.length) return dropped.push({ url: found.url, reason: problems.join("; ") });
        taken.add(key);
        kept.push({ key, found });
      }),
    );
    run.log.event("submitted", { kept: kept.map((k) => k.key), dropped });
    const summary = `Kept ${kept.length} document(s) so far; dropped ${dropped.length}${dropped.length ? `:\n${dropped.map((d) => `- ${d.url}: ${d.reason}`).join("\n")}` : "."}`;
    if (kept.length < MIN_KEPT && submissions < 2) {
      return { done: false, message: `${summary}\nThat's too few. Search further (other regions, other kinds of events, reviews and catalogues) and call submit_sources again with additional documents.` };
    }
    return { done: true, message: `${summary} You are done.` };
  });

  const loop = await runAgentLoop({
    client: rt.client,
    model: rt.config.model,
    effort: "low",
    fallback: rt.config.fallback,
    system: readFileSync(join(import.meta.dirname, "prompt.md"), "utf8"),
    prompt: [
      `Find documents that list many dated events from ${fmtYear(period.from)} to ${fmtYear(period.to)} (years ${period.from} to ${period.to}). Today is ${run.today}.`,
      `You have up to ${WEB_SEARCHES} web searches; Europe PMC searches are free. Then call submit_sources.`,
    ].join("\n"),
    tools: [searchEuropePmc, submit] as AgentTool[],
    serverTools: webSearch(WEB_SEARCHES),
    maxTurns: 12,
    maxUsd: Math.min(rt.config.maxUsd, 1),
    ctx: { evidence: run.evidence, signal: rt.signal },
    log: run.log,
    isDone: () => submissions >= 2 || (submitted !== undefined && kept.length >= MIN_KEPT),
    nudge: "You ended your turn without submitting. Call submit_sources with the documents you found.",
  });

  const base = { period, runId: run.id, costUsd: loop.costUsd, dropped };
  if (!submitted) return { ...base, status: "incomplete", kept: [], reason: `stopped (${loop.stopped}) before submitting` };
  if (opts.dryRun) return { ...base, status: "dry-run", kept: kept.map((k) => k.key) };

  await withWrite(rt.driver, async (tx) => {
    for (const { key, found } of kept) {
      const { covers: _c, ...proposed } = found;
      // Bibliographic details come from search results until the harvester reads the document.
      await putSource(tx, key, { ...toSource({ ...proposed, key }, run.today), consulted: false, note: found.covers });
      await setHarvest(tx, key, { status: "pending", foundBy: run.id, foundFor: periodSlug(period) });
    }
    await recordAgentRun(tx, run, {
      model: rt.config.model,
      loop,
      outcome: "saved",
      summary: `${kept.length} document(s) to harvest, ${dropped.length} dropped. ${submitted!.notes}`,
      props: { from: period.from, to: period.to },
    });
  });
  run.log.event("end", { kept: kept.map((k) => k.key), costUsd: loop.costUsd });
  return { ...base, status: "saved", kept: kept.map((k) => k.key) };
}
