import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Emergence, Idea } from "../../src/content/schema.ts";
import { refreshEmbeddings } from "../../kg/src/embeddings.ts";
import { addAliases, loadEmergences, loadEntries, loadSources, putIdea, replaceEmergences } from "../../kg/src/repository.ts";
import { runAgentLoop } from "../core/loop.ts";
import { SOURCE_POLICY } from "../core/policy.ts";
import { recordAgentRun, startRun, withRead, withWrite, type Runtime } from "../core/runtime.ts";
import { uniqueId } from "../core/slug.ts";
import { findSimilarIdeas, fmtYear, getEvent, getIdea, listEvents } from "../core/tools/graph.ts";
import { sourceTools, webSearch } from "../core/tools/index.ts";
import type { AgentTool } from "../core/tools/types.ts";
import { periodSlug, type Period } from "../core/period.ts";
import { createSubmitInterpretationTool, type Interpretation } from "./schema.ts";

export interface InterpretResult {
  status: "saved" | "dry-run" | "skipped" | "incomplete";
  period: Period;
  runId: string;
  costUsd: number;
  matched: string[];
  created: string[];
  emergences: number;
  reason?: string;
}

/**
 * Identify the ideas a period's events show emerging:
 *   load the period's events → agent loop (read events and their sources,
 *   match ideas by vector search, find evidence for each connection, submit)
 *   → harness checks → write candidate ideas and EMERGES_IN links → re-embed.
 * Re-running a period replaces its unreviewed emergences.
 */
export async function interpretPeriod(period: Period, rt: Runtime, opts: { dryRun?: boolean } = {}): Promise<InterpretResult> {
  const setup = await withRead(rt.driver, async (tx) => ({
    events: (await loadEntries(tx, "Event", period)).filter((e) => e.status !== "candidate"),
    existing: await loadEmergences(tx),
    ideas: new Set<string>((await tx.run(`MATCH (i:Idea) RETURN i.id AS id`)).records.map((r) => r.get("id"))),
    sourceKeys: new Set(Object.keys(await loadSources(tx))),
  }));
  const empty = { matched: [], created: [], emergences: 0 };
  if (!setup.events.length) {
    return { status: "skipped", period, runId: "-", costUsd: 0, ...empty, reason: "no events recorded for this period; gather them first" };
  }
  const eventIds = setup.events.map((e) => e.id);
  const existing = setup.existing.filter((e) => eventIds.includes(e.event));

  const run = startRun("interpreter", periodSlug(period));
  let accepted: Interpretation | undefined;
  let gaveUp: string[] | undefined;
  run.log.event("start", { period, events: eventIds, model: rt.config.model, dryRun: !!opts.dryRun });

  const submit = createSubmitInterpretationTool(
    {
      evidence: run.evidence,
      events: new Map(setup.events.map((e) => [e.id, e.date.year])),
      ideaExists: (id) => setup.ideas.has(id),
      sourceExists: (k) => setup.sourceKeys.has(k),
    },
    (x) => (accepted = x),
    (p) => (gaveUp = p),
  );

  const eventList = setup.events
    .map((e) => `- ${e.id}: ${e.title} (${fmtYear(e.date.year)}${e.date.approx ? ", approx." : ""}; ${e.kind}; ${e.place})`)
    .join("\n");
  const existingList = existing.map((e) => `- ${e.idea} -> ${e.event} [${e.stage}, ${e.status}]: ${e.why}`).join("\n");

  const loop = await runAgentLoop({
    client: rt.client,
    model: rt.config.model,
    effort: rt.config.effort,
    fallback: rt.config.fallback,
    system: `${readFileSync(join(import.meta.dirname, "prompt.md"), "utf8")}\n${SOURCE_POLICY}\n`,
    prompt: [
      `Identify the ideas that the events from ${fmtYear(period.from)} to ${fmtYear(period.to)} show emerging. Today is ${run.today}.`,
      "",
      "<events>",
      eventList,
      "</events>",
      existing.length ? `\nEmergences already recorded for these events (unreviewed ones are replaced by your submission; resubmit those that hold up):\n${existingList}` : "",
      "",
      "Read the events, look up similar ideas, find evidence for each connection, account for every event, then call submit_interpretation.",
    ].join("\n"),
    tools: [...sourceTools, getEvent, listEvents, findSimilarIdeas, getIdea, submit] as AgentTool[],
    serverTools: webSearch(rt.config.maxWebSearches),
    maxTurns: rt.config.maxTurns,
    maxUsd: rt.config.maxUsd,
    ctx: { evidence: run.evidence, signal: rt.signal, graph: { driver: rt.driver, embedder: rt.embedder } },
    log: run.log,
    isDone: () => accepted !== undefined || gaveUp !== undefined,
    nudge: "You ended your turn without submitting. Continue if you need to, then call submit_interpretation.",
  });

  const base = { period, runId: run.id, costUsd: loop.costUsd };
  if (!accepted) {
    run.log.event("incomplete", { stopped: loop.stopped, gaveUp });
    return { ...base, ...empty, status: "incomplete", reason: gaveUp ? "submission rejected too many times" : `stopped (${loop.stopped}) before submitting` };
  }
  const x: Interpretation = accepted;
  run.log.event("accepted", { interpretation: x });
  const count = x.ideas.reduce((n, i) => n + i.emergences.length, 0);

  if (opts.dryRun) {
    return { ...base, status: "dry-run", matched: x.ideas.flatMap((i) => i.existing_id ?? []), created: x.ideas.filter((i) => !i.existing_id).map((i) => i.title), emergences: count };
  }

  const written = await withWrite(rt.driver, async (tx) => {
    const matched: string[] = [];
    const created: string[] = [];
    const taken = new Set<string>();
    const emergences: Emergence[] = [];

    for (const item of x.ideas) {
      let ideaId = item.existing_id;
      if (ideaId) {
        matched.push(ideaId);
        if (item.aliases.length) await addAliases(tx, "Idea", ideaId, item.aliases);
      } else {
        ideaId = await uniqueId(tx, "Idea", item.title, taken);
        taken.add(ideaId);
        const idea: Idea = {
          id: ideaId,
          title: item.title.trim(),
          category: item.category,
          status: "candidate",
          date: { year: item.year!, approx: item.approx, marks: `Estimated by the interpreter agent: ${item.year_basis!.trim()}` },
          origin: item.origin!.trim(),
          summary: item.summary.trim(),
          aliases: item.aliases,
          sources: [],
          body: `Identified by the interpreter agent (run ${run.id}) from ${item.emergences.map((e) => `\`${e.event_id}\``).join(", ")}; not yet curated or sourced.`,
        };
        await putIdea(tx, idea);
        created.push(ideaId);
      }
      for (const em of item.emergences) {
        emergences.push({
          idea: ideaId,
          event: em.event_id,
          stage: em.stage,
          why: em.why,
          status: "proposed",
          evidence: em.evidence,
          evidenceUrl: run.evidence.locate(em.evidence, em.evidence_url)!.finalUrl,
          sourceKey: em.source_key ?? undefined,
          locator: em.locator ?? undefined,
          confidence: em.confidence,
          runId: run.id,
          model: rt.config.model,
        });
      }
    }
    await replaceEmergences(tx, eventIds, emergences);
    await recordAgentRun(tx, run, {
      model: rt.config.model,
      loop,
      outcome: "saved",
      summary: `${matched.length} existing idea(s), ${created.length} new candidate(s), ${emergences.length} emergence(s); ${x.events_without_ideas.length} event(s) without ideas. ${x.notes}`,
      props: { from: period.from, to: period.to },
    });
    return { matched, created, emergences: emergences.length };
  });

  await refreshEmbeddings(rt.driver, rt.embedder);
  run.log.event("end", { ...written, costUsd: loop.costUsd });
  return { ...base, status: "saved", ...written };
}
