import { z } from "zod/v4";
import type { Bibliography } from "../../src/content/schema.ts";
import { checkCitedExcerpt, type SourceRegistry } from "../core/sources.ts";
import { defineTool, ToolError } from "../core/tools/types.ts";
import type { CheckContext, ObservationType } from "./observations/types.ts";

// The gatherer's structured output and the harness checks applied to it. The
// item schema comes from the observation type; sources and evidence are checked
// the same way for every type. New sources are registered during the run with
// register_source, and cited here by key.

export const MAX_OBSERVATIONS = 60;
const MAX_REJECTIONS = 3;

export function submissionSchema<I>(type: ObservationType<I>) {
  return z.strictObject({
    observations: z.array(type.item),
    omitted: z
      .array(z.strictObject({ description: z.string(), reason: z.string() }))
      .describe(`${type.noun}s you found but left out, and why (no usable source, outside the period, too uncertain)`),
    coverage_notes: z.string().describe("Which regions and kinds you searched, and where the record is thin or you ran out of budget"),
  });
}

export interface Submission<I> {
  observations: I[];
  omitted: { description: string; reason: string }[];
  coverage_notes: string;
}

export interface GatherContext extends CheckContext {
  /** The bibliography as it stands before this run. */
  bibliography: Bibliography;
  /** Sources registered during this run. */
  registry: SourceRegistry;
}

export function checkSubmission<I>(type: ObservationType<I>, s: Submission<I>, ctx: GatherContext): string[] {
  const problems: string[] = [];
  if (s.observations.length > MAX_OBSERVATIONS) problems.push(`at most ${MAX_OBSERVATIONS} ${type.noun}s per run; keep the best-attested and note the rest in omitted`);
  const bibliography: Bibliography = { ...ctx.bibliography, ...Object.fromEntries(ctx.registry) };

  const titles = new Set<string>();
  s.observations.forEach((item, n) => {
    const at = `observations[${n}] ${type.describe(item)}`;
    const key = type.describe(item).toLowerCase();
    if (titles.has(key)) problems.push(`${at}: listed twice`);
    titles.add(key);
    problems.push(...type.check(item, at, ctx));
    for (const c of type.citations(item)) {
      const problem = checkCitedExcerpt(at, c.source_key, c.excerpt, bibliography, ctx.evidence);
      if (problem) problems.push(problem.includes("no source with key") ? `${problem} (register new works with register_source first)` : problem);
    }
  });
  return problems;
}

/** The registered sources a submission actually cites. */
export function citedRegistered<I>(type: ObservationType<I>, s: Submission<I>, registry: SourceRegistry): Bibliography {
  const cited = new Set(s.observations.flatMap((o) => type.citations(o).map((c) => c.source_key)));
  return Object.fromEntries([...registry].filter(([key]) => cited.has(key)));
}

export function createSubmitTool<I>(type: ObservationType<I>, ctx: GatherContext, onAccept: (s: Submission<I>) => void, onGiveUp: (problems: string[]) => void) {
  let rejections = 0;
  let accepted = false;
  return defineTool({
    name: "submit_observations",
    description:
      `Submit the ${type.noun}s you gathered and what you left out. Call this once, when you're done. ` +
      "The harness checks every excerpt against the cited source's own document as you read it, and the rules for this observation type; " +
      "if anything fails you get the list of problems and must fix them and submit again.",
    input: submissionSchema(type),
    strict: true,
    async run(submission) {
      if (accepted) throw new ToolError("Observations have already been accepted for this run.");
      const s = submission as Submission<I>;
      const problems = checkSubmission(type, s, ctx);
      if (problems.length) {
        if (++rejections > MAX_REJECTIONS) {
          onGiveUp(problems);
          throw new ToolError(`Rejected too many times; this run ends without saving.\n- ${problems.join("\n- ")}`);
        }
        throw new ToolError(`Submission rejected (${rejections}/${MAX_REJECTIONS}). Fix these and submit again:\n- ${problems.join("\n- ")}`);
      }
      accepted = true;
      onAccept(s);
      return "Observations accepted. You are done; reply with a one-line summary.";
    },
  });
}
