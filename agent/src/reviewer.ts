import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { relative } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.ts";
import { EvidenceLedger } from "./evidence.ts";
import { RunLog } from "./log.ts";
import { runAgentLoop } from "./loop.ts";
import { NUDGE, systemPrompt, taskPrompt } from "./prompt.ts";
import { renderReport } from "./report.ts";
import type { ReviewStore } from "./store/types.ts";
import { buildTools } from "./tools/index.ts";
import { decide, type AcceptedSubmission } from "./verdict.ts";

export type ReviewResult =
  | { status: "pass" | "fail"; id: string; runId: string; blocking: string[]; reportPath?: string; costUsd: number }
  | { status: "skipped"; id: string; reason: string }
  | { status: "incomplete"; id: string; runId: string; reason: string; costUsd: number };

export interface ReviewDeps {
  client: Anthropic;
  config: Config;
  store: ReviewStore;
  signal: AbortSignal;
}

/**
 * Review one idea end to end:
 *   load (store) → check eligibility → agent loop (tools + verdict)
 *   → decide (code) → render report → save (store).
 * The agent never touches storage; it can only submit a verdict, and the
 * harness decides what is recorded.
 */
export async function reviewIdea(id: string, deps: ReviewDeps, opts: { dryRun?: boolean; force?: boolean } = {}): Promise<ReviewResult> {
  const { config, store } = deps;
  const subject = await store.load(id);
  const { idea } = subject;

  if (idea.status === "draft") return { status: "skipped", id, reason: "drafts are not reviewed; source it first" };
  if (idea.status === "reviewed" && idea.review?.hash === subject.hash && !opts.force) {
    return { status: "skipped", id, reason: `already reviewed on ${idea.review.date} and unchanged (use --force to re-review)` };
  }

  const today = new Date().toISOString().slice(0, 10);
  const runId = `${today}-${id}-${randomBytes(3).toString("hex")}`;
  const log = new RunLog(runId);
  const evidence = new EvidenceLedger();
  let accepted: AcceptedSubmission | undefined;

  log.event("start", { idea: id, hash: subject.hash, model: config.model, effort: config.effort, store: store.name, dryRun: !!opts.dryRun });
  const { tools, serverTools } = buildTools({ subject, evidence, maxWebSearches: config.maxWebSearches, onAccept: (a) => (accepted = a) });

  const loop = await runAgentLoop({
    client: deps.client,
    model: config.model,
    effort: config.effort,
    fallback: config.fallback,
    system: systemPrompt(),
    prompt: taskPrompt(subject, today),
    tools,
    serverTools,
    maxTurns: config.maxTurns,
    maxUsd: config.maxUsd,
    ctx: { evidence, signal: deps.signal },
    log,
    isDone: () => accepted !== undefined,
    nudge: NUDGE,
  });

  if (!accepted) {
    // No verdict means no review: nothing is recorded and the status is unchanged.
    log.event("incomplete", { stopped: loop.stopped });
    return { status: "incomplete", id, runId, reason: `stopped (${loop.stopped}) before submitting a verdict`, costUsd: loop.costUsd };
  }

  const decision = decide(accepted);
  const report = renderReport({
    subject,
    accepted,
    decision,
    documents: evidence.all(),
    run: { id: runId, date: today, model: config.model, loop, logPath: relative(process.cwd(), log.path) },
  });
  log.event("decision", { ...decision, submission: accepted.submission });

  let reportPath: string | undefined;
  if (opts.dryRun) {
    reportPath = relative(process.cwd(), log.path.replace(/\.jsonl$/, ".md"));
    writeFileSync(reportPath, report);
  } else {
    await store.save({ ideaId: id, verdict: decision.verdict, date: today, hash: subject.hash, runId, report });
  }
  log.event("end", { verdict: decision.verdict, costUsd: loop.costUsd, turns: loop.turns });

  return {
    status: decision.verdict,
    id,
    runId,
    blocking: decision.verdict === "fail" ? [...accepted.submission.blocking_issues, ...accepted.unresolved] : [],
    reportPath,
    costUsd: loop.costUsd,
  };
}
