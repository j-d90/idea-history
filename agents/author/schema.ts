import { z } from "zod/v4";
import { checkEntry, CITATION, scanCitations } from "../../src/content/rules.ts";
import { isIdea, type Bibliography, type Entry } from "../../src/content/schema.ts";
import type { EvidenceLedger } from "../core/evidence.ts";
import { checkCitedExcerpt, Citation, quote, type SourceRegistry } from "../core/sources.ts";
import { defineTool, ToolError } from "../core/tools/types.ts";

// The author's structured output and the harness checks applied to it. The
// author rewrites an entry's content; the harness keeps its id, classification
// and aliases, appends the supporting excerpts to the body as quotes (so the
// fact-checker's batch check can verify them), derives its sources from the
// citations, and sets it to "sourced".

export const AuthorSubmissionSchema = z.strictObject({
  decision: z.enum(["write", "decline"]).describe("decline: the entry shouldn't exist as it stands, or you couldn't source it"),
  reason: z.string().describe("For write: what you changed and why, in a sentence or two. For decline: why"),
  title: z.string(),
  byline: z.string().describe("An idea's origin (who / where) or an event's place"),
  summary: z.string().describe("One or two sentences, at most 320 characters, no citations"),
  year: z.number().describe("Placement year, negative for BCE"),
  earliest: z.number().nullable(),
  latest: z.number().nullable(),
  approx: z.boolean(),
  date_marks: z.string().describe("What the year marks"),
  date_note: z.string().nullable().describe("Why the date is uncertain or contested; may contain [@key, locator] citations"),
  body: z.string().describe("Markdown prose, every claim cited as [@key, locator]; may be empty if the excerpts say it all. Don't include the excerpts: they're appended as quotes"),
  support: z
    .array(Citation)
    .describe("Verbatim excerpts backing every claim, including the title, byline, summary and date; at least one for every distinct [@key, locator] you cite. Appended to the body as quotes"),
});

export type AuthorSubmission = z.infer<typeof AuthorSubmissionSchema>;

export interface AuthorContext {
  current: Entry;
  evidence: EvidenceLedger;
  /** The bibliography before this run. */
  bibliography: Bibliography;
  registry: SourceRegistry;
}

const MAX_REJECTIONS = 3;
const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** Quoted passages of four or more words: "…" or “…”. */
const QUOTED = /[“"]([^”"]{12,}?)[”"]/g;

/** The entry the submission describes: prose, then the supporting excerpts as quotes; sources in order of first citation. */
export function buildEntry(s: AuthorSubmission, current: Entry): Entry {
  const prose = s.body
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(">"))
    .join("\n")
    .trim();
  const body = [prose, ...s.support.map(quote)].filter(Boolean).join("\n\n");
  const keys: string[] = [];
  for (const text of [body, s.date_note ?? ""]) for (const c of scanCitations(text).cites) if (!keys.includes(c.key)) keys.push(c.key);
  const common = {
    id: current.id,
    title: s.title.trim(),
    status: "sourced" as const,
    date: {
      year: s.year,
      marks: s.date_marks.trim(),
      earliest: s.earliest ?? undefined,
      latest: s.latest ?? undefined,
      approx: s.approx,
      note: s.date_note?.trim() || undefined,
    },
    summary: s.summary.trim(),
    aliases: current.aliases,
    sources: keys,
    body,
  };
  return isIdea(current) ? { ...common, category: current.category, origin: s.byline.trim() } : { ...common, kind: current.kind, place: s.byline.trim() };
}

export function checkAuthorSubmission(s: AuthorSubmission, ctx: AuthorContext): string[] {
  if (s.decision === "decline") return s.reason.trim() ? [] : ["a decline needs a reason"];

  const problems: string[] = [];
  const bibliography: Bibliography = { ...ctx.bibliography, ...Object.fromEntries(ctx.registry) };
  const intYears = [s.year, s.earliest, s.latest].every((y) => y === null || (Number.isInteger(y) && y !== 0));
  if (!intYears) problems.push("years must be integers, and there is no year 0 (1 BCE is -1)");
  if (!s.title.trim() || !s.byline.trim() || !s.summary.trim()) problems.push("title, byline and summary are required");
  if (!s.support.length) problems.push("at least one supporting excerpt is required");
  if (s.support.some((c) => /\[@|\n/.test(c.excerpt))) problems.push('an excerpt can\'t contain "[@" or line breaks');

  const entry = buildEntry(s, ctx.current);
  if (intYears) {
    for (const p of checkEntry(entry, bibliography)) {
      problems.push(p.includes("is not in the bibliography") ? `${p} (register new works with register_source first)` : p);
    }
  }

  // Every distinct citation is backed by an excerpt from that source, at that locator.
  const supported = new Set(s.support.map((c) => `${c.source_key}|${norm(c.locator)}`));
  for (const text of [s.body, s.date_note ?? ""]) {
    for (const c of scanCitations(text).cites) {
      if (!supported.has(`${c.key}|${norm(c.locator)}`)) {
        problems.push(`citation [@${c.key}${c.locator ? `, ${c.locator}` : ""}] has no support item with that source_key and locator`);
      }
    }
  }
  s.support.forEach((c, n) => {
    const problem = checkCitedExcerpt(`support[${n}] (${c.source_key}${c.locator ? `, ${c.locator}` : ""})`, c.source_key, c.excerpt, bibliography, ctx.evidence);
    if (problem) problems.push(problem);
  });

  // Quotation marks promise verbatim words. Citation locators may contain quotation marks of their own.
  for (const [, quoted] of `${s.body}\n${s.date_note ?? ""}`.replace(CITATION, " ").matchAll(QUOTED)) {
    if (quoted.trim().split(/\s+/).length >= 4 && !ctx.evidence.locate(quoted)) {
      problems.push(`the quotation "${quoted}" was not found in any document you read; quote exactly, or paraphrase without quotation marks`);
    }
  }
  return [...new Set(problems)];
}

export function createSubmitEntryTool(ctx: AuthorContext, onAccept: (s: AuthorSubmission) => void, onGiveUp: (problems: string[]) => void) {
  let rejections = 0;
  let accepted = false;
  return defineTool({
    name: "submit_entry",
    description:
      "Submit the rewritten entry (or decline it). Call this once, when you're done. The harness checks the entry against the content rules, " +
      "that every citation has a supporting excerpt found verbatim in that source as you read it, and that every quotation is verbatim; if " +
      "anything fails you get the list of problems and must fix them and submit again.",
    input: AuthorSubmissionSchema,
    strict: true,
    async run(submission) {
      if (accepted) throw new ToolError("An entry has already been accepted for this run.");
      const problems = checkAuthorSubmission(submission, ctx);
      if (problems.length) {
        if (++rejections > MAX_REJECTIONS) {
          onGiveUp(problems);
          throw new ToolError(`Rejected too many times; this run ends without saving.\n- ${problems.join("\n- ")}`);
        }
        throw new ToolError(`Submission rejected (${rejections}/${MAX_REJECTIONS}). Fix these and submit again:\n- ${problems.join("\n- ")}`);
      }
      accepted = true;
      onAccept(submission);
      return "Entry accepted. You are done; reply with a one-line summary.";
    },
  });
}
