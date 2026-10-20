import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { Idea, IdeaLink } from "../../src/content/schema.ts";
import { loadIdea, nodeEmbedding, loadLinks, loadSources, replaceLinks, similarIdeas } from "../../kg/src/repository.ts";
import { runAgentLoop } from "../core/loop.ts";
import { SOURCE_POLICY } from "../core/policy.ts";
import { recordAgentRun, startRun, withRead, withWrite, type Runtime } from "../core/runtime.ts";
import { sourceTools, webSearch } from "../core/tools/index.ts";
import { findSimilarIdeas, getIdea } from "../core/tools/graph.ts";
import type { AgentTool } from "../core/tools/types.ts";
import { createSubmitLinksTool, type LinkSubmission } from "./schema.ts";

const CANDIDATES = 12;

export interface LinkResult {
  status: "saved" | "dry-run" | "skipped" | "incomplete";
  ideaId: string;
  runId: string;
  costUsd: number;
  links: Pick<IdeaLink, "to" | "type" | "why" | "confidence">[];
  removedSeeds: number;
  reason?: string;
}

/**
 * Determine an idea's links to earlier ideas:
 *   vector search for similar earlier ideas (+ existing seed links)
 *   → agent loop (read both ideas' sources, search, submit typed links with evidence)
 *   → harness checks → replace the idea's seed and previous linker links.
 * Reviewed links are kept.
 */
export async function linkIdea(id: string, rt: Runtime, opts: { dryRun?: boolean } = {}): Promise<LinkResult> {
  const setup = await withRead(rt.driver, async (tx) => {
    const idea = await loadIdea(tx, id);
    if (!idea) throw new Error(`no idea with id "${id}"`);
    const vector = await nodeEmbedding(tx, "Idea", id);
    if (!vector) throw new Error(`${id} has no embedding yet (run npm run kg -- embed)`);
    const similar = await similarIdeas(tx, vector, { k: CANDIDATES, maxYear: idea.date.year, exclude: [id] });
    const existing = await loadLinks(tx, id);
    const candidates: Idea[] = [];
    for (const target of new Set([...similar.map((s) => s.id), ...existing.map((l) => l.to)])) {
      const t = await loadIdea(tx, target);
      if (t && t.status !== "candidate") candidates.push(t);
    }
    const all = (await tx.run(`MATCH (i:Idea) RETURN i.id AS id, i.year AS year, i.status AS status`)).records.map((r) => r.toObject() as { id: string; year: number; status: string });
    const sourceKeys = new Set(Object.keys(await loadSources(tx)));
    return { idea, similar, existing, candidates, ideas: new Map(all.map((x) => [x.id, x])), sourceKeys };
  });
  const { idea, existing, candidates } = setup;
  if (idea.status === "candidate") throw new Error(`${id} is an uncurated candidate; curate it before linking`);

  const run = startRun("linker", id);
  let accepted: LinkSubmission | undefined;
  let gaveUp: string[] | undefined;
  run.log.event("start", { idea: id, candidates: candidates.map((c) => c.id), model: rt.config.model, dryRun: !!opts.dryRun });

  const submit = createSubmitLinksTool(
    {
      ideaId: id,
      ideaYear: idea.date.year,
      evidence: run.evidence,
      mustConsider: candidates.map((c) => c.id),
      lookup: (x) => setup.ideas.get(x),
      sourceExists: (k) => setup.sourceKeys.has(k),
    },
    (s) => (accepted = s),
    (p) => (gaveUp = p),
  );

  const loop = await runAgentLoop({
    client: rt.client,
    model: rt.config.model,
    effort: rt.config.effort,
    fallback: rt.config.fallback,
    system: `${readFileSync(join(import.meta.dirname, "prompt.md"), "utf8")}\n${SOURCE_POLICY}\n`,
    prompt: taskPrompt(idea, candidates, existing, setup.similar, run.today),
    tools: [...sourceTools, findSimilarIdeas, getIdea, submit] as AgentTool[],
    serverTools: webSearch(rt.config.maxWebSearches),
    maxTurns: rt.config.maxTurns,
    maxUsd: rt.config.maxUsd,
    ctx: { evidence: run.evidence, signal: rt.signal, graph: { driver: rt.driver, embedder: rt.embedder } },
    log: run.log,
    isDone: () => accepted !== undefined || gaveUp !== undefined,
    nudge: "You ended your turn without submitting. Continue checking if you need to, then call submit_links.",
  });

  const base = { ideaId: id, runId: run.id, costUsd: loop.costUsd };
  if (!accepted) {
    run.log.event("incomplete", { stopped: loop.stopped, gaveUp });
    return { ...base, status: "incomplete", links: [], removedSeeds: 0, reason: gaveUp ? "submission rejected too many times" : `stopped (${loop.stopped}) before submitting` };
  }
  const s = accepted;
  run.log.event("accepted", { submission: s });

  const links: IdeaLink[] = s.links.map((l) => ({
    from: id,
    to: l.target_id,
    type: l.type,
    why: l.why,
    origin: "linker",
    status: "proposed",
    evidence: l.evidence,
    evidenceUrl: run.evidence.locate(l.evidence, l.evidence_url)!.finalUrl,
    sourceKey: l.source_key ?? undefined,
    locator: l.locator ?? undefined,
    confidence: l.confidence,
    runId: run.id,
    model: rt.config.model,
  }));
  const summary = links.map(({ to, type, why, confidence }) => ({ to, type, why, confidence }));
  const removedSeeds = existing.filter((l) => l.origin === "seed" && !links.some((n) => n.to === l.to)).length;

  if (opts.dryRun) return { ...base, status: "dry-run", links: summary, removedSeeds };

  await withWrite(rt.driver, async (tx) => {
    await replaceLinks(tx, id, ["seed", "linker"], links);
    await recordAgentRun(tx, run, {
      model: rt.config.model,
      loop,
      outcome: "saved",
      summary: `${links.length} link(s); ${s.considered.length} candidate(s) considered without a link; ${removedSeeds} unverified seed link(s) removed`,
      about: { label: "Idea", key: id },
    });
  });
  run.log.event("end", { links: summary, removedSeeds, costUsd: loop.costUsd });
  return { ...base, status: "saved", links: summary, removedSeeds };
}

function taskPrompt(idea: Idea, candidates: Idea[], existing: IdeaLink[], similar: { id: string; score: number }[], today: string): string {
  const score = new Map(similar.map((s) => [s.id, s.score]));
  const { body, review: _r, status: _s, ...fields } = idea;
  const candidateList = candidates
    .map((c) => {
      const seed = existing.find((l) => l.to === c.id && l.origin === "seed");
      const sim = score.get(c.id);
      return [
        `- id: ${c.id}`,
        `  title: ${c.title}`,
        `  year: ${c.date.year}${c.date.approx ? " (approx.)" : ""}`,
        `  status: ${c.status}`,
        `  summary: ${c.summary}`,
        sim !== undefined ? `  vector similarity: ${sim.toFixed(3)}` : "  (not in the vector results)",
        seed ? `  existing unverified seed link: ${seed.type}${seed.why ? ` ("${seed.why}")` : ""}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  return [
    `Determine how the idea "${idea.id}" relates to earlier ideas. Today is ${today}.`,
    "",
    `<idea id="${idea.id}">`,
    stringify(fields, { lineWidth: 0 }).trimEnd(),
    "---",
    body,
    "</idea>",
    "",
    "<candidates>",
    candidateList || "(none)",
    "</candidates>",
    "",
    "Account for every candidate in links or considered, then call submit_links.",
  ].join("\n");
}
