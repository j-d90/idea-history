import { stringify } from "yaml";
import { REVIEWER } from "../../src/content/schema.ts";
import type { SourceDocument } from "../core/evidence.ts";
import type { LoopResult } from "../core/loop.ts";
import type { ReviewSubject } from "./types.ts";
import type { AcceptedSubmission } from "./verdict.ts";

export interface ReportInput {
  subject: ReviewSubject;
  accepted: AcceptedSubmission;
  decision: { verdict: "pass" | "fail"; reasons: string[] };
  documents: SourceDocument[];
  run: { id: string; date: string; model: string; loop: LoopResult; logPath: string };
}

const cell = (s: string | null | undefined) => (s ?? "—").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const yes = (b: boolean) => (b ? "yes" : "**no**");

/**
 * Render the review report. The verdict and claim assessments are the agent's;
 * the decision, the evidence verification and the list of documents read come
 * from the harness, so the report can't overstate what was actually checked.
 */
export function renderReport({ subject, accepted, decision, documents, run }: ReportInput): string {
  const s = accepted.submission;
  const frontmatter = stringify({
    idea: subject.idea.id,
    verdict: decision.verdict,
    reviewer: REVIEWER,
    date: run.date,
    hash: subject.hash,
    run_id: run.id,
    model: run.model,
    served_by: run.loop.servedBy,
    turns: run.loop.turns,
    est_cost_usd: Number(run.loop.costUsd.toFixed(2)),
  });

  const lines: string[] = [`---\n${frontmatter}---`, "", `# Review: ${subject.idea.title}`, ""];

  lines.push("## Verdict", "", `**${decision.verdict.toUpperCase()}**. ${s.summary}`, "");
  if (decision.verdict === "fail" && s.verdict === "pass") {
    lines.push(`The reviewer proposed a pass, but the harness recorded a fail: ${decision.reasons.join("; ")}.`, "");
  }
  if (accepted.unresolved.length) {
    lines.push("Problems the reviewer did not resolve after repeated rejections:", "", ...accepted.unresolved.map((p) => `- ${p}`), "");
  }

  lines.push("## Sources", "", "| Key | Read the work | How | Bibliographic details correct | Notes |", "|---|---|---|---|---|");
  for (const x of s.sources) lines.push(`| ${x.key} | ${yes(x.accessed)} | ${cell(x.how)} | ${yes(x.bibliographic_details_correct)} | ${cell(x.notes)} |`);
  lines.push("");

  lines.push(
    "## Documents read",
    "",
    "Recorded by the harness: every document fetched during the review, with a hash of the text the reviewer saw.",
    "",
    "| Document | Type | Fetched | SHA-256 |",
    "|---|---|---|---|",
  );
  for (const d of documents) {
    const label = d.title ? `[${cell(d.title)}](${d.finalUrl})` : d.finalUrl;
    lines.push(`| ${label} | ${d.kind} | ${d.fetchedAt.slice(0, 16).replace("T", " ")} | \`${d.sha256.slice(0, 12)}\` |`);
  }
  if (!documents.length) lines.push("| (none) | | | |");
  lines.push("");

  lines.push(
    "## Claims",
    "",
    "**Excerpt verified** means the harness found the excerpt verbatim in a document listed above.",
    "",
    "| # | Claim | Where | Source, locator | Evidence | Excerpt verified | Verdict | Note |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const c of s.claims) {
    const where = c.location;
    const src = [c.source_key, c.locator].filter(Boolean).join(", ") || "—";
    const verifiedAt = accepted.verified.get(c.id);
    const verified = verifiedAt ? `yes (${new URL(verifiedAt).hostname})` : c.evidence ? "**no**" : "—";
    lines.push(`| ${c.id} | ${cell(c.text)} | ${where} | ${cell(src)} | ${cell(c.evidence)} | ${verified} | ${c.verdict} | ${cell(c.note)} |`);
  }
  lines.push("");

  lines.push(
    "## Entry-level checks",
    "",
    `- **Summary and title:** ${s.checks.summary_and_title}`,
    `- **Date:** ${s.checks.date}`,
    `- **Attribution and framing:** ${s.checks.attribution_and_framing}`,
    "- **Searches for disagreement:**",
    ...(s.checks.disagreement_searches.length ? s.checks.disagreement_searches.map((d) => `  - "${d.query}": ${d.finding}`) : ["  - none recorded"]),
    "",
  );

  lines.push("## Blocking issues", "", ...(s.blocking_issues.length ? s.blocking_issues.map((b, i) => `${i + 1}. ${b}`) : ["None."]), "");
  lines.push("## Non-blocking suggestions", "", ...(s.suggestions.length ? s.suggestions.map((b) => `- ${b}`) : ["None."]), "");

  lines.push(
    "## Run",
    "",
    `- Model: ${run.model}${run.loop.servedBy.some((m) => m !== run.model) ? ` (served by ${run.loop.servedBy.join(", ")} after a refusal fallback)` : ""}`,
    `- Turns: ${run.loop.turns}; estimated model cost: $${run.loop.costUsd.toFixed(2)} (excludes web search fees)`,
    `- Full transcript: \`${run.logPath}\` (local)`,
    "",
  );

  return lines.join("\n");
}
