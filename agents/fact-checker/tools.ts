import type Anthropic from "@anthropic-ai/sdk";
import type { EvidenceLedger } from "../core/evidence.ts";
import { sourceTools, webSearch } from "../core/tools/index.ts";
import type { AgentTool } from "../core/tools/types.ts";
import type { ReviewSubject } from "./types.ts";
import { createSubmitTool, type AcceptedSubmission } from "./verdict.ts";

/**
 * The fact-checker's toolset. Deliberately narrow: it can read sources and
 * submit a verdict, and nothing else. It has no file system, shell or database
 * access, so it cannot edit content or its own record; persisting the result is
 * the harness's job.
 */
export function buildTools(opts: {
  subject: ReviewSubject;
  evidence: EvidenceLedger;
  maxWebSearches: number;
  onAccept: (a: AcceptedSubmission) => void;
}): { tools: AgentTool[]; serverTools: Anthropic.Beta.BetaToolUnion[] } {
  return {
    tools: [...sourceTools, createSubmitTool(opts.subject, opts.evidence, opts.onAccept)] as AgentTool[],
    serverTools: webSearch(opts.maxWebSearches),
  };
}
