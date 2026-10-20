import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { labelOf, type Entry, type EntryLabel, type ReviewRecord } from "../../src/content/schema.ts";
import { entryKey } from "../../src/content/rules.ts";
import { refreshEmbeddings } from "../../kg/src/embeddings.ts";
import { loadLatestReviews, loadSources, loadSubject, putEntry, putSource } from "../../kg/src/repository.ts";
import { runAgentLoop } from "../core/loop.ts";
import { SOURCE_POLICY } from "../core/policy.ts";
import { recordAgentRun, startRun, withRead, withWrite, type Runtime } from "../core/runtime.ts";
import { createRegisterSourceTool, type SourceRegistry } from "../core/sources.ts";
import { loadDocument } from "../core/tools/documents.ts";
import { findSimilarIdeas, getEvent, getIdea } from "../core/tools/graph.ts";
import { sourceTools, webSearch } from "../core/tools/index.ts";
import type { AgentTool } from "../core/tools/types.ts";
import { buildEntry, createSubmitEntryTool, type AuthorSubmission } from "./schema.ts";

export interface AuthorResult {
  status: "written" | "declined" | "dry-run" | "skipped" | "incomplete";
  label: EntryLabel;
  id: string;
  runId: string;
  costUsd: number;
  reason?: string;
  sources?: string[];
}

/** Why an entry needs the author, or null if it doesn't. */
export function authorTask(entry: Entry, review: ReviewRecord | undefined, hash: string): "curate" | "source" | "revise" | null {
  if (entry.status === "candidate") return "curate";
  if (entry.status === "draft") return "source";
  if (entry.status === "sourced" && review?.verdict === "fail" && review.hash === hash) return "revise";
  return null;
}

/**
 * Write or revise one idea or event:
 *   load it (and its latest failed review) → agent loop (find and read sources,
 *   register new ones, write, support every citation, submit)
 *   → harness checks → write the entry and its new sources in one transaction.
 * The entry ends up "sourced", ready for the fact-checker.
 *
 * `light`: revise after a failed batch check without research. The harness loads
 * the entry's cited sources itself; the agent has no tools but submit, and
 * rewrites the entry within its existing, verified excerpts. Costs about a cent.
 */
export async function authorEntry(label: EntryLabel, id: string, rt: Runtime, opts: { dryRun?: boolean; force?: boolean; light?: boolean } = {}): Promise<AuthorResult> {
  const setup = await withRead(rt.driver, async (tx) => {
    const subject = await loadSubject(tx, label, id);
    const review = (await loadLatestReviews(tx)).get(entryKey(label, id));
    return { ...subject, review, bibliography: await loadSources(tx) };
  });
  const { entry, review } = setup;
  const task = authorTask(entry, review, setup.hash) ?? (opts.force && entry.status === "sourced" ? "revise" : null);
  if (!task) {
    return { status: "skipped", label, id, runId: "-", costUsd: 0, reason: `${entry.status}${review ? ` (last review: ${review.verdict})` : ""}; nothing for the author to do (use --force to rewrite a sourced entry)` };
  }

  const light = !!opts.light && task === "revise";
  const run = startRun("author", id);
  let accepted: AuthorSubmission | undefined;
  let gaveUp: string[] | undefined;
  run.log.event("start", { label, id, task, light, hash: setup.hash, model: rt.config.model, dryRun: !!opts.dryRun });

  if (light) {
    // The excerpts are checked against the sources as fetched now, so load them before the agent starts.
    for (const [key, source] of Object.entries(setup.sources)) {
      const url = source.url ?? (source.doi ? `https://doi.org/${source.doi}` : undefined);
      if (!url) continue;
      try {
        await loadDocument(url, { evidence: run.evidence, signal: rt.signal });
      } catch (e) {
        return { status: "incomplete", label, id, runId: run.id, costUsd: 0, reason: `couldn't re-read "${key}" for a light revision (${(e as Error).message})` };
      }
    }
  }

  const registry: SourceRegistry = new Map();
  const register = createRegisterSourceTool({ evidence: run.evidence, sourceExists: (k) => k in setup.bibliography, today: run.today }, registry);
  const submit = createSubmitEntryTool(
    { current: entry, evidence: run.evidence, bibliography: setup.bibliography, registry },
    (s) => (accepted = s),
    (p) => (gaveUp = p),
  );

  const loop = await runAgentLoop({
    client: rt.client,
    model: rt.config.model,
    effort: light ? "medium" : rt.config.effort,
    fallback: rt.config.fallback,
    system: light ? readFileSync(join(import.meta.dirname, "light-prompt.md"), "utf8") : `${readFileSync(join(import.meta.dirname, "prompt.md"), "utf8")}\n${SOURCE_POLICY}\n`,
    prompt: taskPrompt(task, entry, setup.sources, task === "revise" ? review : undefined, run.today),
    tools: (light ? [submit] : [...sourceTools, getIdea, getEvent, findSimilarIdeas, register, submit]) as AgentTool[],
    serverTools: light ? [] : webSearch(rt.config.maxWebSearches),
    maxTurns: light ? 6 : rt.config.maxTurns,
    maxUsd: rt.config.maxUsd,
    ctx: { evidence: run.evidence, signal: rt.signal, graph: { driver: rt.driver, embedder: rt.embedder } },
    log: run.log,
    isDone: () => accepted !== undefined || gaveUp !== undefined,
    nudge: "You ended your turn without submitting. Continue if you need to, then call submit_entry.",
  });

  const base = { label, id, runId: run.id, costUsd: loop.costUsd };
  if (!accepted) {
    run.log.event("incomplete", { stopped: loop.stopped, gaveUp });
    return { ...base, status: "incomplete", reason: gaveUp ? "submission rejected too many times" : `stopped (${loop.stopped}) before submitting` };
  }
  const s: AuthorSubmission = accepted;
  const written = s.decision === "write" ? buildEntry(s, entry) : undefined;
  const newSources = Object.fromEntries([...registry].filter(([key]) => written?.sources.includes(key)));
  run.log.event("accepted", { submission: s, entry: written, newSources });

  if (opts.dryRun) return { ...base, status: "dry-run", reason: `${s.decision}: ${s.reason}`, sources: written?.sources };

  await withWrite(rt.driver, async (tx) => {
    if (written) {
      // Never overwrite an entry that changed while the author was working on it.
      const current = await loadSubject(tx, label, id);
      if (current.hash !== setup.hash || current.entry.status !== entry.status) throw new Error(`${id} changed during the run; nothing was saved`);
      for (const [key, source] of Object.entries(newSources)) await putSource(tx, key, source);
      await putEntry(tx, written);
    }
    await recordAgentRun(tx, run, {
      model: rt.config.model,
      loop,
      outcome: s.decision === "write" ? "written" : "declined",
      props: { light: light ? 1 : 0 },
      summary: `${light ? "light " : ""}${task}: ${s.reason}`,
      about: { label: labelOf(entry), key: id },
    });
  });
  if (written) await refreshEmbeddings(rt.driver, rt.embedder);
  run.log.event("end", { decision: s.decision, costUsd: loop.costUsd });
  return { ...base, status: s.decision === "write" ? "written" : "declined", reason: s.reason, sources: written?.sources };
}

function taskPrompt(task: "curate" | "source" | "revise", entry: Entry, sources: Record<string, unknown>, review: ReviewRecord | undefined, today: string): string {
  const what = labelOf(entry) === "Event" ? "event" : "idea";
  const { body, review: _r, status, aliases: _a, ...fields } = entry;
  const intro = {
    curate: `The ${what} "${entry.id}" is an uncurated candidate. Decide whether it should exist; if so, write it as a sourced entry, otherwise decline it.`,
    source: `The ${what} "${entry.id}" is an unsourced draft. Write it as a sourced entry, keeping only what sources support.`,
    revise: `The ${what} "${entry.id}" needs revision${review ? " after a failed review" : ""}. Fix it so every claim is supported.`,
  }[task];
  return [
    `${intro} Today is ${today}.`,
    "",
    `<entry type="${what}" status="${status}">`,
    stringify(fields, { lineWidth: 0 }).trimEnd(),
    "---",
    body,
    "</entry>",
    "",
    "<bibliography>",
    Object.keys(sources).length ? stringify(sources, { lineWidth: 0 }).trimEnd() : "(none)",
    "</bibliography>",
    review ? `\n<review_report>\n${review.report}\n</review_report>` : "",
    "",
    "Find and read sources, register new ones, then call submit_entry.",
  ].join("\n");
}
