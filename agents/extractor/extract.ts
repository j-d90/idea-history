import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { Idea, Source } from "../../src/content/schema.ts";
import { refreshEmbeddings } from "../../kg/src/embeddings.ts";
import { addDiscusses, addIdeaAliases, linkIdeaEntity, loadSources, putIdea, upsertEntity } from "../../kg/src/repository.ts";
import { runAgentLoop } from "../core/loop.ts";
import { SOURCE_POLICY } from "../core/policy.ts";
import { recordAgentRun, startRun, withRead, withWrite, type Run, type Runtime } from "../core/runtime.ts";
import { uniqueId } from "../core/slug.ts";
import { sourceTools } from "../core/tools/index.ts";
import { findSimilarEntities, findSimilarIdeas, getIdea } from "../core/tools/graph.ts";
import type { AgentTool } from "../core/tools/types.ts";
import { createSubmitExtractionTool, type AcceptedExtraction } from "./schema.ts";

export interface ExtractResult {
  status: "saved" | "dry-run" | "incomplete";
  sourceKey: string;
  runId: string;
  costUsd: number;
  matched: string[];
  created: string[];
  entities: number;
  reason?: string;
}

/**
 * Extract ideas, aliases and entities from one source document:
 *   load source → agent loop (read, look up similar ideas/entities, submit)
 *   → harness checks → write to the graph → re-embed what changed.
 * New ideas are created as uncurated candidates; known ideas gain aliases and a
 * DISCUSSES link from the source.
 */
export async function extractFromSource(key: string, rt: Runtime, opts: { dryRun?: boolean; focus?: string } = {}): Promise<ExtractResult> {
  const source = (await withRead(rt.driver, (tx) => loadSources(tx, [key])))[key];
  if (!source) throw new Error(`no source with key "${key}"`);
  const url = source.url ?? (source.doi ? `https://doi.org/${source.doi}` : undefined);
  if (!url) throw new Error(`source "${key}" has no url or doi to read`);

  const ids = await withRead(rt.driver, async (tx) => ({
    ideas: new Set<string>((await tx.run(`MATCH (i:Idea) RETURN i.id AS id`)).records.map((r) => r.get("id"))),
    entities: new Set<string>((await tx.run(`MATCH (e:Entity) RETURN e.id AS id`)).records.map((r) => r.get("id"))),
  }));

  const run = startRun("extractor", key);
  let accepted: AcceptedExtraction | undefined;
  let gaveUp: string[] | undefined;
  run.log.event("start", { source: key, url, model: rt.config.model, dryRun: !!opts.dryRun });

  const submit = createSubmitExtractionTool(
    { evidence: run.evidence, ideaExists: (id) => ids.ideas.has(id), entityExists: (id) => ids.entities.has(id) },
    (a) => (accepted = a),
    (p) => (gaveUp = p),
  );
  const loop = await runAgentLoop({
    client: rt.client,
    model: rt.config.model,
    effort: rt.config.effort,
    fallback: rt.config.fallback,
    system: `${readFileSync(join(import.meta.dirname, "prompt.md"), "utf8")}\n${SOURCE_POLICY}\n`,
    prompt: taskPrompt(key, source, url, run, opts.focus),
    tools: [...sourceTools, findSimilarIdeas, findSimilarEntities, getIdea, submit] as AgentTool[],
    serverTools: [],
    maxTurns: rt.config.maxTurns,
    maxUsd: rt.config.maxUsd,
    ctx: { evidence: run.evidence, signal: rt.signal, graph: { driver: rt.driver, embedder: rt.embedder } },
    log: run.log,
    isDone: () => accepted !== undefined || gaveUp !== undefined,
    nudge: "You ended your turn without submitting. Continue reading if you need to, then call submit_extraction.",
  });

  const base = { sourceKey: key, runId: run.id, costUsd: loop.costUsd };
  if (!accepted) {
    run.log.event("incomplete", { stopped: loop.stopped, gaveUp });
    return { ...base, status: "incomplete", matched: [], created: [], entities: 0, reason: gaveUp ? "submission rejected too many times" : `stopped (${loop.stopped}) before submitting` };
  }
  const x = accepted.extraction;
  run.log.event("accepted", { extraction: x });

  if (opts.dryRun) {
    return { ...base, status: "dry-run", matched: x.ideas.flatMap((i) => i.existing_id ?? []), created: x.ideas.filter((i) => !i.existing_id).map((i) => i.title), entities: x.ideas.reduce((n, i) => n + i.entities.length, 0) };
  }

  const written = await withWrite(rt.driver, async (tx) => {
    const created: string[] = [];
    const matched: string[] = [];
    const takenIdeas = new Set<string>();
    const entityIds = new Map<string, string>(); // name|kind → id, so one entity mentioned by several ideas is created once
    let entities = 0;

    for (const item of x.ideas) {
      let ideaId = item.existing_id;
      if (ideaId) {
        matched.push(ideaId);
        if (item.aliases.length) await addIdeaAliases(tx, ideaId, item.aliases);
      } else {
        ideaId = await uniqueId(tx, "Idea", item.title, takenIdeas);
        takenIdeas.add(ideaId);
        const cite = `[@${key}${item.locator ? `, ${item.locator}` : ""}]`;
        const idea: Idea = {
          id: ideaId,
          title: item.title.trim(),
          category: item.category,
          status: "candidate",
          date: { year: item.year!, approx: item.approx, marks: `Estimated by the extractor agent: ${item.year_basis}` },
          origin: item.origin!.trim(),
          summary: item.summary.trim(),
          aliases: item.aliases,
          sources: [key],
          body: `> ${item.evidence} ${cite}\n\nProposed by the extractor agent (run ${run.id}); not yet curated.`,
        };
        await putIdea(tx, idea);
        created.push(ideaId);
      }
      await addDiscusses(tx, key, ideaId, { evidence: item.evidence, locator: item.locator ?? undefined, runId: run.id });

      for (const e of item.entities) {
        const ref = `${e.name.trim().toLowerCase()}|${e.kind}`;
        let entityId = e.existing_id ?? entityIds.get(ref);
        if (!entityId) {
          entityId = await uniqueId(tx, "Entity", e.name);
          entities++;
        }
        entityIds.set(ref, entityId);
        await upsertEntity(tx, { id: entityId, name: e.name.trim(), kind: e.kind, description: e.description, aliases: e.aliases }, run.id);
        await linkIdeaEntity(tx, ideaId, entityId, e.role, run.id);
      }
    }

    const summary = `${matched.length} matched, ${created.length} new candidate(s), ${entities} new entit(ies)`;
    await recordAgentRun(tx, run, { model: rt.config.model, loop, outcome: "saved", summary, about: { label: "Source", key } });
    return { created, matched, entities };
  });

  await refreshEmbeddings(rt.driver, rt.embedder);
  run.log.event("end", { ...written, costUsd: loop.costUsd });
  return { ...base, status: "saved", ...written };
}

function taskPrompt(key: string, source: Source, url: string, run: Run, focus?: string): string {
  return [
    `Extract the ideas discussed in the source "${key}". Today is ${run.today}.`,
    "",
    "<bibliography_entry>",
    stringify({ [key]: source }, { lineWidth: 0 }).trimEnd(),
    "</bibliography_entry>",
    "",
    `Read it at: ${url}`,
    source.pages ? `The work occupies printed ${source.pages} of that document.` : "",
    focus ? `Focus: ${focus}` : "",
    "",
    "Match each idea against the graph with find_similar_ideas, record entities (reusing existing ones), then call submit_extraction.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
