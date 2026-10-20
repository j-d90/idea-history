import { readFileSync } from "node:fs";
import { join } from "node:path";
import { refreshEmbeddings } from "../../kg/src/embeddings.ts";
import { loadSources, putSource } from "../../kg/src/repository.ts";
import { periodSlug, type Period } from "../core/period.ts";
import { runAgentLoop } from "../core/loop.ts";
import { SOURCE_POLICY } from "../core/policy.ts";
import { recordAgentRun, startRun, withRead, withWrite, type Runtime } from "../core/runtime.ts";
import { createRegisterSourceTool, type SourceRegistry } from "../core/sources.ts";
import { findSimilarEntities, findSimilarEvents, fmtYear, getEvent, listEvents } from "../core/tools/graph.ts";
import { sourceTools, webSearch } from "../core/tools/index.ts";
import type { AgentTool } from "../core/tools/types.ts";
import { events } from "./observations/events.ts";
import type { ObservationType } from "./observations/types.ts";
import { citedRegistered, createSubmitTool, MAX_OBSERVATIONS, type Submission } from "./schema.ts";

/** The observation types the gatherer can collect, by command-line name. */
export const observationTypes: Record<string, ObservationType<any>> = { events };

export interface GatherResult {
  status: "saved" | "dry-run" | "incomplete";
  type: string;
  period: Period;
  runId: string;
  costUsd: number;
  created: string[];
  updated: string[];
  sources: string[];
  entities: number;
  omitted: number;
  coverage?: string;
  reason?: string;
}

/**
 * Gather observations of one type for a period:
 *   load what the graph has → agent loop (survey, read, quote, dedupe, submit)
 *   → harness checks every excerpt against the cited source as read
 *   → write new sources and observations in one transaction → re-embed.
 */
export async function gather<I>(
  type: ObservationType<I>,
  period: Period,
  rt: Runtime,
  opts: { dryRun?: boolean; focus?: string; maxSearches?: number } = {},
): Promise<GatherResult> {
  if (period.from > period.to) throw new Error(`the period starts (${period.from}) after it ends (${period.to})`);
  const setup = await withRead(rt.driver, async (tx) => ({
    bibliography: await loadSources(tx),
    nodes: new Set<string>((await tx.run(`MATCH (e:Event) RETURN e.id AS id`)).records.map((r) => r.get("id"))),
    entities: new Set<string>((await tx.run(`MATCH (e:Entity) RETURN e.id AS id`)).records.map((r) => r.get("id"))),
  }));

  const run = startRun("gatherer", `${type.name}-${periodSlug(period)}`);
  let accepted: Submission<I> | undefined;
  let gaveUp: string[] | undefined;
  const searches = opts.maxSearches ?? Math.max(rt.config.maxWebSearches, 30);
  run.log.event("start", { type: type.name, period, focus: opts.focus, model: rt.config.model, searches, dryRun: !!opts.dryRun });

  const registry: SourceRegistry = new Map();
  const register = createRegisterSourceTool({ evidence: run.evidence, sourceExists: (k) => k in setup.bibliography, today: run.today }, registry);
  const submit = createSubmitTool(
    type,
    {
      ...period,
      evidence: run.evidence,
      exists: (id) => setup.nodes.has(id),
      entityExists: (id) => setup.entities.has(id),
      bibliography: setup.bibliography,
      registry,
    },
    (s) => (accepted = s),
    (p) => (gaveUp = p),
  );

  const loop = await runAgentLoop({
    client: rt.client,
    model: rt.config.model,
    effort: rt.config.effort,
    fallback: rt.config.fallback,
    system: `${readFileSync(join(import.meta.dirname, "prompt.md"), "utf8")}\n${type.guidance}\n${SOURCE_POLICY}\n`,
    prompt: [
      `Gather ${type.name} from ${fmtYear(period.from)} to ${fmtYear(period.to)} (years ${period.from} to ${period.to}). Today is ${run.today}.`,
      opts.focus ? `Focus: ${opts.focus}` : "",
      `You have up to ${searches} web searches and a budget of about $${rt.config.maxUsd.toFixed(2)}; record at most ${MAX_OBSERVATIONS} ${type.noun}s.`,
      "Check what the graph already holds for the period, survey it, read, register and quote your sources, then call submit_observations.",
    ]
      .filter(Boolean)
      .join("\n"),
    tools: [...sourceTools, listEvents, findSimilarEvents, getEvent, findSimilarEntities, register, submit] as AgentTool[],
    serverTools: webSearch(searches),
    maxTurns: rt.config.maxTurns,
    maxUsd: rt.config.maxUsd,
    ctx: { evidence: run.evidence, signal: rt.signal, graph: { driver: rt.driver, embedder: rt.embedder } },
    log: run.log,
    isDone: () => accepted !== undefined || gaveUp !== undefined,
    nudge: "You ended your turn without submitting. Continue if you need to, then call submit_observations.",
  });

  const base = { type: type.name, period, runId: run.id, costUsd: loop.costUsd };
  const empty = { created: [], updated: [], sources: [], entities: 0, omitted: 0 };
  if (!accepted) {
    run.log.event("incomplete", { stopped: loop.stopped, gaveUp });
    return { ...base, ...empty, status: "incomplete", reason: gaveUp ? "submission rejected too many times" : `stopped (${loop.stopped}) before submitting` };
  }
  const s: Submission<I> = accepted;
  const newSources = citedRegistered(type, s, registry);
  let sources = Object.keys(newSources);
  run.log.event("accepted", { submission: s, newSources });

  if (opts.dryRun) {
    return {
      ...base,
      ...empty,
      status: "dry-run",
      created: s.observations.map((o) => type.describe(o)),
      sources,
      omitted: s.omitted.length,
      coverage: s.coverage_notes,
    };
  }

  const written = await withWrite(rt.driver, async (tx) => {
    // Another run may have registered the same key meanwhile: reuse it if it's the same work, otherwise rename ours.
    const current = await loadSources(tx, Object.keys(newSources));
    const renamed = new Map<string, string>();
    for (const [key, source] of Object.entries(newSources)) {
      const other = current[key];
      if (other && other.url === source.url) continue;
      let final = key;
      for (let n = 2; other && (await loadSources(tx, [final]))[final]; n++) final = `${key}-${n}`;
      if (final !== key) renamed.set(key, final);
      await putSource(tx, final, source);
    }
    for (const o of s.observations) for (const c of type.citations(o)) c.source_key = renamed.get(c.source_key) ?? c.source_key;
    for (const [from, to] of renamed) {
      newSources[to] = newSources[from];
      delete newSources[from];
    }
    const result = await type.write(tx, s.observations, { runId: run.id, bibliography: { ...setup.bibliography, ...current, ...newSources } });
    await recordAgentRun(tx, run, {
      model: rt.config.model,
      loop,
      outcome: "saved",
      summary: `${result.created.length} new ${type.noun}(s), ${result.updated.length} updated, ${sources.length} new source(s), ${s.omitted.length} omitted. Coverage: ${s.coverage_notes}`,
      props: { observation: type.name, from: period.from, to: period.to },
    });
    return result;
  });

  sources = Object.keys(newSources);
  await refreshEmbeddings(rt.driver, rt.embedder);
  run.log.event("end", { ...written, costUsd: loop.costUsd });
  return { ...base, status: "saved", ...written, sources, omitted: s.omitted.length, coverage: s.coverage_notes };
}
