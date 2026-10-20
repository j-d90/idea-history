import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ManagedTransaction } from "neo4j-driver";
import type { HistoricalEvent, Source } from "../../src/content/schema.ts";
import { embeddingText, harvestStates, loadEvent, loadSources, putEvent, putSource, setEmbedding, setEventScope, setHarvest, similarEvents } from "../../kg/src/repository.ts";
import { estimateCost } from "../core/config.ts";
import type { SourceDocument } from "../core/evidence.ts";
import { recordAgentRun, startRun, withRead, withWrite, type Run, type Runtime } from "../core/runtime.ts";
import { uniqueId } from "../core/slug.ts";
import { quote } from "../core/sources.ts";
import { loadDocument } from "../core/tools/documents.ts";
import { checkHarvested, harvestJsonSchema, HarvestOutput, type HarvestedEvent } from "./schema.ts";

// The harvester extracts every dated event from documents the finder stored:
// no agent loop, one structured-output call per document chunk on the cheapest
// model, optionally through the Batch API at half price. The harness verifies
// each excerpt against the document, merges duplicates of existing events by
// vector similarity, and writes the rest as sourced events.

/** Characters per chunk: about 50K tokens, well under Haiku's 100K price step. */
const CHUNK_CHARS = 200_000;
/** Chunks per document at most, to bound the cost of very long documents. */
const MAX_CHUNKS = 8;
/** Cosine similarity at or above which an extracted event is taken to be one already recorded. */
const SAME_EVENT = 0.92;
/** Events dated after this from documents found for an earlier period are research history or modern intrusions. */
const LATEST_FOR_EARLY_PERIODS = 1500;
const PARALLEL = 4;

export interface HarvestResult {
  key: string;
  status: "done" | "failed" | "dry-run";
  created: number;
  merged: number;
  rejected: number;
  costUsd: number;
  note?: string;
}

interface Job {
  key: string;
  /** The period the finder found it for, e.g. "150000bce-125001bce". */
  foundFor?: string;
  source: Source;
  doc: SourceDocument;
  chunks: string[];
  run: Run;
}

/** Split a document into chunks, on PDF page boundaries when it has pages. */
export function chunkDocument(doc: SourceDocument): string[] {
  const units = doc.pages ? doc.pages.map((p, i) => `=== PDF p. ${i + 1} ===\n${p}`) : doc.text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length > CHUNK_CHARS) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + unit.slice(0, CHUNK_CHARS);
  }
  if (current.trim()) chunks.push(current);
  return chunks.slice(0, MAX_CHUNKS);
}

function request(job: Job, n: number, model: string): Anthropic.MessageCreateParamsNonStreaming {
  const s = job.source;
  const who = s.authors.length ? s.authors.join(", ") : (s.short ?? s.publisher ?? "");
  return {
    model,
    max_tokens: 32_000,
    system: [{ type: "text", text: readFileSync(join(import.meta.dirname, "prompt.md"), "utf8"), cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: { type: "json_schema", schema: harvestJsonSchema() } },
    messages: [
      {
        role: "user",
        content: [
          `Document: ${who ? `${who}, ` : ""}"${s.title}" (${s.year})${s.container ? `, ${s.container}` : ""}.`,
          `Part ${n + 1} of ${job.chunks.length}.`,
          "<document>",
          job.chunks[n],
          "</document>",
          "Extract every dated event this part states.",
        ].join("\n"),
      },
    ],
  };
}

/** Parse one response into events, or an error note. */
function parse(message: Anthropic.Message): { events: HarvestedEvent[]; note?: string } {
  if (message.stop_reason === "refusal") return { events: [], note: "the model declined this part" };
  if (message.stop_reason === "max_tokens") return { events: [], note: "the response was cut off" };
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return { events: HarvestOutput.parse(JSON.parse(text)).events };
  } catch (e) {
    return { events: [], note: `unreadable response: ${(e as Error).message.slice(0, 120)}` };
  }
}

async function runImmediately(rt: Runtime, requests: { id: string; params: Anthropic.MessageCreateParamsNonStreaming }[]) {
  const out = new Map<string, { message?: Anthropic.Message; error?: string }>();
  const queue = [...requests];
  const worker = async () => {
    while (queue.length && !rt.signal.aborted) {
      const r = queue.shift()!;
      try {
        // Streaming, because a response this size can outlast the SDK's non-streaming timeout.
        out.set(r.id, { message: await rt.client.messages.stream(r.params, { signal: rt.signal }).finalMessage() });
      } catch (e) {
        if (rt.signal.aborted) throw e;
        out.set(r.id, { error: (e as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return out;
}

async function runAsBatch(rt: Runtime, requests: { id: string; params: Anthropic.MessageCreateParamsNonStreaming }[]) {
  const batch = await rt.client.messages.batches.create({ requests: requests.map((r) => ({ custom_id: r.id, params: r.params })) });
  console.error(`  batch ${batch.id}: ${requests.length} request(s) submitted; polling every 30s (most finish within an hour)`);
  let status = batch;
  while (status.processing_status !== "ended") {
    if (rt.signal.aborted) throw new Error(`aborted; batch ${batch.id} keeps running on the API (cancel it with the Console or API if unwanted)`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    status = await rt.client.messages.batches.retrieve(batch.id);
    const c = status.request_counts;
    console.error(`  batch ${batch.id}: ${status.processing_status}, ${c.succeeded} done, ${c.processing} processing, ${c.errored} errored`);
  }
  const out = new Map<string, { message?: Anthropic.Message; error?: string }>();
  for await (const r of await rt.client.messages.batches.results(batch.id)) {
    if (r.result.type === "succeeded") out.set(r.custom_id, { message: r.result.message });
    else out.set(r.custom_id, { error: r.result.type === "errored" ? `${r.result.error.error.type}` : r.result.type });
  }
  return out;
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
};

/** The last year of a finder period slug ("150000bce-125001bce" gives -125001). */
export function foundForEnd(slug: string | undefined): number | undefined {
  const m = /-(\d+)(bce|ce)$/.exec(slug ?? "");
  return m ? (m[2] === "bce" ? -Number(m[1]) : Number(m[1])) : undefined;
}

/** How far apart two dates can be and still be the same event: wider in deep time. */
const tolerance = (year: number) => Math.max(50, Math.abs(year) * 0.05);

/**
 * Harvest events from the given pending sources. With `batch`, every chunk of
 * every source goes into one Batch API job (half price; this call waits for it).
 */
export async function harvestSources(keys: string[], rt: Runtime, opts: { batch?: boolean; dryRun?: boolean } = {}): Promise<HarvestResult[]> {
  const model = rt.config.harvestModel;
  const { bibliography, states } = await withRead(rt.driver, async (tx) => ({ bibliography: await loadSources(tx, keys), states: await harvestStates(tx) }));
  const results: HarvestResult[] = [];
  const jobs: Job[] = [];

  // Fetch each document once (no model tokens).
  for (const key of keys) {
    const source = bibliography[key];
    const run = startRun("harvester", key);
    const url = source?.url ?? (source?.doi ? `https://doi.org/${source.doi}` : undefined);
    if (!source || !url) {
      results.push({ key, status: "failed", created: 0, merged: 0, rejected: 0, costUsd: 0, note: "no url or doi" });
      continue;
    }
    try {
      const doc = await loadDocument(url, { evidence: run.evidence, signal: rt.signal });
      jobs.push({ key, foundFor: states[key]?.foundFor, source, doc, chunks: chunkDocument(doc), run });
      run.log.event("start", { key, url, model, chunks: jobs.at(-1)!.chunks.length, batch: !!opts.batch });
    } catch (e) {
      if (rt.signal.aborted) throw e;
      results.push({ key, status: "failed", created: 0, merged: 0, rejected: 0, costUsd: 0, note: `couldn't fetch: ${(e as Error).message}` });
    }
  }
  if (!opts.dryRun) {
    await withWrite(rt.driver, async (tx) => {
      for (const r of results) await setHarvest(tx, r.key, { status: "failed", note: r.note });
    });
  }

  const requests = jobs.flatMap((job, j) => job.chunks.map((_, n) => ({ id: `${j}-${n}`, params: request(job, n, model) })));
  const responses = requests.length ? await (opts.batch ? runAsBatch(rt, requests) : runImmediately(rt, requests)) : new Map();

  // Session-wide record of events created in this harvest, so duplicates across chunks and sources merge too.
  const fresh: { id: string; year: number; vector: number[] }[] = [];

  for (const [j, job] of jobs.entries()) {
    const notes: string[] = [];
    let costUsd = 0;
    const extracted: HarvestedEvent[] = [];
    for (let n = 0; n < job.chunks.length; n++) {
      const r = responses.get(`${j}-${n}`);
      if (!r?.message) {
        notes.push(`part ${n + 1}: ${r?.error ?? "no response"}`);
        continue;
      }
      costUsd += estimateCost(r.message.model, r.message.usage, { batch: opts.batch });
      const parsed = parse(r.message);
      if (parsed.note) notes.push(`part ${n + 1}: ${parsed.note}`);
      extracted.push(...parsed.events);
    }

    const valid: HarvestedEvent[] = [];
    let rejected = 0;
    const outOfScope: Record<string, number> = {};
    const periodEnd = foundForEnd(job.foundFor);
    for (const e of extracted) {
      const scope = e.scope !== "human-past" ? e.scope : periodEnd !== undefined && periodEnd < LATEST_FOR_EARLY_PERIODS && e.year > LATEST_FOR_EARLY_PERIODS ? "modern" : undefined;
      if (scope) {
        outOfScope[scope] = (outOfScope[scope] ?? 0) + 1;
        job.run.log.event("out-of-scope", { event: e, scope });
        continue;
      }
      const problems = checkHarvested(e, job.doc.url, job.run.evidence);
      if (problems.length) {
        rejected++;
        job.run.log.event("rejected", { event: e, problems });
      } else valid.push(e);
    }
    job.run.log.event("extracted", { extracted: extracted.length, valid: valid.length, rejected, outOfScope, notes });

    if (opts.dryRun) {
      results.push({ key: job.key, status: "dry-run", created: valid.length, merged: 0, rejected, costUsd, note: notes.join("; ") || undefined });
      continue;
    }

    const texts = valid.map((e) => embeddingText({ title: e.title.trim(), summary: e.summary.trim(), aliases: [], kind: `${e.kind} event, ${e.place.trim()}` }));
    const vectors = texts.length ? await rt.embedder.embed(texts) : [];
    const counts = await withWrite(rt.driver, async (tx) => {
      const c = { created: 0, merged: 0 };
      const taken = new Set<string>();
      // Bibliographic details came from search results; the document has now been read.
      await putSource(tx, job.key, { ...job.source, consulted: true, accessed: job.run.today });
      for (const [i, e] of valid.entries()) {
        const citations = e.excerpts.map((x) => ({ source_key: job.key, locator: x.locator, excerpt: x.text }));
        const same = await findSame(tx, vectors[i], e.year, fresh);
        if (same) {
          await mergeInto(tx, same, citations.map(quote), job.key);
          c.merged++;
          continue;
        }
        const id = await uniqueId(tx, "Event", e.title, taken);
        taken.add(id);
        const event: HistoricalEvent = {
          id,
          title: e.title.trim(),
          kind: e.kind,
          status: "sourced",
          date: { year: e.year, marks: e.date_marks.trim(), earliest: e.earliest ?? undefined, latest: e.latest ?? undefined, approx: e.approx, note: e.date_note?.trim() || undefined },
          place: e.place.trim(),
          summary: e.summary.trim(),
          aliases: [],
          sources: [job.key],
          body: [...new Set(citations.map(quote))].join("\n\n"),
        };
        await putEvent(tx, event);
        await setEventScope(tx, id, "human-past", "harvester");
        await setEmbedding(tx, "Event", id, vectors[i], rt.embedder.hash(texts[i]));
        fresh.push({ id, year: e.year, vector: vectors[i] });
        c.created++;
      }
      const status: "done" | "failed" = extracted.length || !notes.length ? "done" : "failed";
      await setHarvest(tx, job.key, { status, events: c.created + c.merged, note: notes.join("; ") || undefined });
      await recordAgentRun(tx, job.run, {
        model,
        loop: { stopped: "done", turns: job.chunks.length, costUsd, servedBy: [model] },
        outcome: status === "done" ? "saved" : "failed",
        summary: `${c.created} new event(s), ${c.merged} merged into existing ones, ${rejected} rejected, out of scope: ${JSON.stringify(outOfScope)}${notes.length ? `; ${notes.join("; ")}` : ""}`,
        about: { label: "Source", key: job.key },
        props: { chunks: job.chunks.length, batch: opts.batch ? 1 : 0 },
      });
      return { ...c, status };
    });
    job.run.log.event("end", { ...counts, rejected, costUsd });
    results.push({ key: job.key, status: counts.status, created: counts.created, merged: counts.merged, rejected, costUsd, note: notes.join("; ") || undefined });
  }
  return results;
}

/** An event already recorded (in the graph or earlier in this harvest) that this one duplicates. */
async function findSame(tx: ManagedTransaction, vector: number[], year: number, fresh: { id: string; year: number; vector: number[] }[]): Promise<string | undefined> {
  const tol = tolerance(year);
  const local = fresh
    .filter((f) => Math.abs(f.year - year) <= tol)
    .map((f) => ({ id: f.id, score: cosine(f.vector, vector) }))
    .sort((a, b) => b.score - a.score)[0];
  if (local && local.score >= SAME_EVENT) return local.id;
  const [hit] = await similarEvents(tx, vector, { k: 1, from: year - tol, to: year + tol });
  return hit && hit.score >= SAME_EVENT ? hit.id : undefined;
}

/** Add this source's quotes to an existing event. */
async function mergeInto(tx: ManagedTransaction, id: string, quotes: string[], key: string): Promise<void> {
  const existing = (await loadEvent(tx, id))!;
  const added = quotes.filter((q) => !existing.body.includes(q));
  if (!added.length) return;
  const sources = existing.sources.includes(key) ? existing.sources : [...existing.sources, key];
  await putEvent(tx, { ...existing, sources, body: [existing.body, ...added].filter(Boolean).join("\n\n") });
}
