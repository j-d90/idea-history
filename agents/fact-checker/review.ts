import { writeFileSync } from "node:fs";
import { relative } from "node:path";
import { REVIEWER, type EntryLabel } from "../../src/content/schema.ts";
import { addReview, loadSubject } from "../../kg/src/repository.ts";
import { runAgentLoop } from "../core/loop.ts";
import { startRun, withRead, withWrite, type Runtime } from "../core/runtime.ts";
import { NUDGE, systemPrompt, taskPrompt } from "./prompt.ts";
import { renderReport } from "./report.ts";
import { buildTools } from "./tools.ts";
import { decide, type AcceptedSubmission } from "./verdict.ts";

export type ReviewResult =
  | { status: "pass" | "fail"; id: string; runId: string; blocking: string[]; reportPath?: string; costUsd: number }
  | { status: "skipped"; id: string; reason: string }
  | { status: "incomplete"; id: string; runId: string; reason: string; costUsd: number };

/**
 * Review one idea or event end to end:
 *   load (graph) → check eligibility → agent loop (tools + verdict)
 *   → decide (code) → render report → record (graph).
 * The agent never touches storage; it can only submit a verdict, and the
 * harness decides what is recorded.
 */
export async function reviewEntry(label: EntryLabel, id: string, rt: Runtime, opts: { dryRun?: boolean; force?: boolean } = {}): Promise<ReviewResult> {
  const { config } = rt;
  const subject = await withRead(rt.driver, (tx) => loadSubject(tx, label, id));
  const { entry } = subject;

  if (entry.status === "candidate" || entry.status === "draft") {
    return { status: "skipped", id, reason: `${entry.status} entries are not reviewed; source it first` };
  }
  if (entry.status === "reviewed" && entry.review?.hash === subject.hash && !opts.force) {
    return { status: "skipped", id, reason: `already reviewed on ${entry.review.date} and unchanged (use --force to re-review)` };
  }

  const run = startRun("fact-checker", id);
  let accepted: AcceptedSubmission | undefined;
  run.log.event("start", { label, id, hash: subject.hash, model: config.model, effort: config.effort, dryRun: !!opts.dryRun });

  const { tools, serverTools } = buildTools({ subject, evidence: run.evidence, maxWebSearches: config.maxWebSearches, onAccept: (a) => (accepted = a) });
  const loop = await runAgentLoop({
    client: rt.client,
    model: config.model,
    effort: config.effort,
    fallback: config.fallback,
    system: systemPrompt(),
    prompt: taskPrompt(subject, run.today),
    tools,
    serverTools,
    maxTurns: config.maxTurns,
    maxUsd: config.maxUsd,
    ctx: { evidence: run.evidence, signal: rt.signal },
    log: run.log,
    isDone: () => accepted !== undefined,
    nudge: NUDGE,
  });

  if (!accepted) {
    // No verdict means no review: nothing is recorded and the status is unchanged.
    run.log.event("incomplete", { stopped: loop.stopped });
    return { status: "incomplete", id, runId: run.id, reason: `stopped (${loop.stopped}) before submitting a verdict`, costUsd: loop.costUsd };
  }

  const decision = decide(accepted);
  const report = renderReport({
    subject,
    accepted,
    decision,
    documents: run.evidence.all(),
    run: { id: run.id, date: run.today, model: config.model, loop, logPath: relative(process.cwd(), run.log.path) },
  });
  run.log.event("decision", { ...decision, submission: accepted.submission });

  let reportPath: string | undefined;
  if (opts.dryRun) {
    reportPath = relative(process.cwd(), run.log.path.replace(/\.jsonl$/, ".md"));
    writeFileSync(reportPath, report);
  } else {
    await withWrite(rt.driver, async (tx) => {
      // Re-read inside the write transaction: never record a review of content that changed during the run.
      const current = await loadSubject(tx, label, id);
      if (current.hash !== subject.hash) throw new Error(`${id} changed during review (reviewed ${subject.hash}, now ${current.hash}); the review was not saved`);
      await addReview(tx, { runId: run.id, label, id, verdict: decision.verdict, by: REVIEWER, date: run.today, hash: subject.hash, report });
    });
  }
  run.log.event("end", { verdict: decision.verdict, costUsd: loop.costUsd, turns: loop.turns });

  return {
    status: decision.verdict,
    id,
    runId: run.id,
    blocking: decision.verdict === "fail" ? [...accepted.submission.blocking_issues, ...accepted.unresolved] : [],
    reportPath,
    costUsd: loop.costUsd,
  };
}
