import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { quotedExcerpts } from "../../src/content/rules.ts";
import { REVIEWER, type Bibliography, type HistoricalEvent } from "../../src/content/schema.ts";
import { addReview, loadSubject } from "../../kg/src/repository.ts";
import { runAgentLoop } from "../core/loop.ts";
import { recordAgentRun, startRun, withRead, withWrite, type Runtime } from "../core/runtime.ts";
import { checkCitedExcerpt } from "../core/sources.ts";
import { loadDocument } from "../core/tools/documents.ts";
import type { AgentTool } from "../core/tools/types.ts";
import { createSubmitCheckTool, type CheckResult, type CheckSubmission } from "./check-schema.ts";

/** Entries per batch: enough to share the prompt overhead, few enough to judge carefully. */
export const CHECK_BATCH = 12;

export interface CheckOutcome {
  id: string;
  status: "checked" | "failed" | "skipped";
  reason?: string;
  issues?: string[];
}

export interface CheckBatchResult {
  status: "saved" | "dry-run" | "incomplete";
  runId: string;
  costUsd: number;
  outcomes: CheckOutcome[];
  reason?: string;
}

interface Verified {
  event: HistoricalEvent;
  sources: Bibliography;
  hash: string;
  excerpts: { excerpt: string; key: string; locator?: string; url: string; sha256: string }[];
}

/** Whether an event can be batch-checked: it quotes at least one excerpt. Otherwise it needs a full review. */
export const checkable = (event: HistoricalEvent) => quotedExcerpts(event.body).length > 0;

/**
 * The fact-checker's batch check of sourced events:
 *   1. the harness re-fetches every cited source and confirms each quoted
 *      excerpt is verbatim in the source it cites (no model tokens);
 *   2. one agent call judges, for all entries at once, whether each entry's
 *      claims stay within its verified excerpts (no tools, no web);
 *   3. code decides, and records a "check" review per entry: a pass sets
 *      "checked", a fail leaves it "sourced" for the author to revise.
 * Entries without quoted excerpts, or whose sources can't be re-read, are skipped.
 */
export async function checkEvents(ids: string[], rt: Runtime, opts: { dryRun?: boolean } = {}): Promise<CheckBatchResult> {
  const run = startRun("fact-checker", `check-${ids.length}-events`);
  const outcomes: CheckOutcome[] = [];
  const subjects = await withRead(rt.driver, async (tx) => Promise.all(ids.map((id) => loadSubject(tx, "Event", id))));
  run.log.event("start", { mode: "check", ids, model: rt.config.model, dryRun: !!opts.dryRun });

  // 1. Re-verify every quoted excerpt against its source, as fetched now.
  const ctx = { evidence: run.evidence, signal: rt.signal };
  const verified: Verified[] = [];
  const harnessFails = new Map<string, { subject: Verified; issues: string[] }>();
  for (const s of subjects) {
    const event = s.entry as HistoricalEvent;
    if (event.status !== "sourced") {
      outcomes.push({ id: event.id, status: "skipped", reason: `status is ${event.status}; only sourced events are checked` });
      continue;
    }
    const quotes = quotedExcerpts(event.body);
    if (!quotes.length) {
      outcomes.push({ id: event.id, status: "skipped", reason: "no quoted excerpts to check against; needs a full review" });
      continue;
    }
    const subject: Verified = { event, sources: s.sources, hash: s.hash, excerpts: [] };
    const issues: string[] = [];
    let unreadable: string | undefined;
    for (const q of quotes) {
      const source = s.sources[q.key];
      const url = source?.url ?? (source?.doi ? `https://doi.org/${source.doi}` : undefined);
      if (!source || !url) {
        issues.push(`body: the excerpt cites "${q.key}", which has no url or doi to check against`);
        continue;
      }
      try {
        await loadDocument(url, ctx);
      } catch (e) {
        unreadable = `couldn't re-read "${q.key}" (${(e as Error).message})`;
        break;
      }
      const problem = checkCitedExcerpt(`body`, q.key, q.excerpt, s.sources, run.evidence);
      if (problem) issues.push(problem);
      else {
        const doc = run.evidence.get(url)!;
        subject.excerpts.push({ ...q, url: doc.finalUrl, sha256: doc.sha256 });
      }
    }
    if (unreadable) outcomes.push({ id: event.id, status: "skipped", reason: unreadable });
    else if (issues.length) harnessFails.set(event.id, { subject, issues });
    else verified.push(subject);
  }
  run.log.event("verified", { verified: verified.map((v) => v.event.id), harnessFails: Object.fromEntries([...harnessFails].map(([k, v]) => [k, v.issues])), outcomes });

  // 2. One call judges the entries whose excerpts all verified.
  let accepted: CheckSubmission | undefined;
  let gaveUp: string[] | undefined;
  let costUsd = 0;
  let loop: Awaited<ReturnType<typeof runAgentLoop>> | undefined;
  if (verified.length) {
    const submit = createSubmitCheckTool(verified.map((v) => v.event.id), (s) => (accepted = s), (p) => (gaveUp = p));
    loop = await runAgentLoop({
      client: rt.client,
      model: rt.config.model,
      effort: "medium",
      fallback: rt.config.fallback,
      system: readFileSync(join(import.meta.dirname, "check-prompt.md"), "utf8"),
      prompt: taskPrompt(verified, run.today),
      tools: [submit] as AgentTool[],
      serverTools: [],
      maxTurns: 5,
      maxUsd: rt.config.maxUsd,
      ctx: { evidence: run.evidence, signal: rt.signal },
      log: run.log,
      isDone: () => accepted !== undefined || gaveUp !== undefined,
      nudge: "You ended your turn without submitting. Call submit_check with a result for every entry.",
    });
    costUsd = loop.costUsd;
    if (!accepted) {
      run.log.event("incomplete", { stopped: loop.stopped, gaveUp });
      for (const v of verified) outcomes.push({ id: v.event.id, status: "skipped", reason: "the check didn't complete" });
      if (!harnessFails.size) return { status: "incomplete", runId: run.id, costUsd, outcomes, reason: gaveUp ? "submission rejected too many times" : `stopped (${loop.stopped})` };
    }
  }

  // 3. Decide and record.
  const results = new Map<string, CheckResult>((accepted?.results ?? []).map((r) => [r.event_id, r]));
  const records: { subject: Verified; verdict: "pass" | "fail"; issues: string[] }[] = [
    ...[...harnessFails.values()].map(({ subject, issues }) => ({ subject, verdict: "fail" as const, issues })),
    ...verified.flatMap((subject) => {
      const r = results.get(subject.event.id);
      if (!r) return [];
      const issues = r.issues.map((i) => `${i.field}: ${i.problem}`);
      return [{ subject, verdict: r.verdict === "pass" && !issues.length ? ("pass" as const) : ("fail" as const), issues }];
    }),
  ];
  for (const r of records) outcomes.push({ id: r.subject.event.id, status: r.verdict === "pass" ? "checked" : "failed", issues: r.issues });

  if (!opts.dryRun && records.length) {
    await withWrite(rt.driver, async (tx) => {
      for (const r of records) {
        // Never record a check of content that changed during the run.
        const current = await loadSubject(tx, "Event", r.subject.event.id);
        if (current.hash !== r.subject.hash) {
          const o = outcomes.find((x) => x.id === r.subject.event.id)!;
          Object.assign(o, { status: "skipped", reason: "changed during the check; not recorded" });
          continue;
        }
        await addReview(tx, {
          runId: `${run.id}-${r.subject.event.id}`.slice(0, 200),
          label: "Event",
          id: r.subject.event.id,
          verdict: r.verdict,
          mode: "check",
          by: REVIEWER,
          date: run.today,
          hash: r.subject.hash,
          report: renderCheckReport(r, run.id, run.today, rt.config.model),
        });
      }
      if (loop) {
        await recordAgentRun(tx, run, {
          model: rt.config.model,
          loop,
          outcome: "saved",
          summary: `check: ${records.filter((r) => r.verdict === "pass").length} passed, ${records.filter((r) => r.verdict === "fail").length} failed, ${outcomes.filter((o) => o.status === "skipped").length} skipped`,
          props: { mode: "check", entries: verified.length },
        });
      }
    });
  }
  run.log.event("end", { outcomes, costUsd });
  return { status: opts.dryRun ? "dry-run" : "saved", runId: run.id, costUsd, outcomes };
}

function taskPrompt(entries: Verified[], today: string): string {
  const blocks = entries.map((v) => {
    const { body, review: _r, status: _s, aliases: _a, sources: _src, ...fields } = v.event;
    const prose = body
      .split("\n")
      .filter((l) => !l.startsWith(">"))
      .join("\n")
      .trim();
    const excerpts = v.excerpts.map((x, n) => `${n + 1}. "${x.excerpt}" (${x.key}${x.locator ? `, ${x.locator}` : ""}; verified at ${x.url})`).join("\n");
    return [`<entry id="${v.event.id}">`, stringify(fields, { lineWidth: 0 }).trimEnd(), prose ? `body prose:\n${prose}` : "", "verified excerpts:", excerpts, "</entry>"]
      .filter(Boolean)
      .join("\n");
  });
  return [`Check these ${entries.length} entries. Today is ${today}.`, "", ...blocks, "", "Judge each entry against its own excerpts, then call submit_check."].join("\n");
}

function renderCheckReport(r: { subject: Verified; verdict: "pass" | "fail"; issues: string[] }, runId: string, date: string, model: string): string {
  const { subject } = r;
  return [
    `---\n${stringify({ event: subject.event.id, mode: "check", verdict: r.verdict, reviewer: REVIEWER, date, hash: subject.hash, run_id: runId, model })}---`,
    "",
    `# Check: ${subject.event.title}`,
    "",
    `**${r.verdict.toUpperCase()}**. A batch check: the entry's claims compared against its quoted excerpts, each re-verified verbatim in its source by the harness.`,
    "",
    "## Verified excerpts",
    "",
    ...(subject.excerpts.length
      ? subject.excerpts.map((x) => `- "${x.excerpt}" (${x.key}${x.locator ? `, ${x.locator}` : ""}; ${x.url}, sha256 \`${x.sha256.slice(0, 12)}\`)`)
      : ["None verified."]),
    "",
    "## Issues",
    "",
    ...(r.issues.length ? r.issues.map((i, n) => `${n + 1}. ${i}`) : ["None."]),
    "",
  ].join("\n");
}
