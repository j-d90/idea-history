import type Anthropic from "@anthropic-ai/sdk";
import type { EvidenceLedger } from "../evidence.ts";
import type { ReviewSubject } from "../store/types.ts";
import { createSubmitTool, type AcceptedSubmission } from "../verdict.ts";
import { readSource, searchSource } from "./documents.ts";
import { findArchivedCopy, getArxivAbstract, getEuropePmcFullText, lookupDoi, searchEuropePmc } from "./scholarly.ts";
import type { AgentTool } from "./types.ts";

/**
 * The fact-checker's toolset. Deliberately narrow: it can read the web and
 * scholarly APIs and submit a verdict, and nothing else. It has no file system,
 * shell or database access, so it cannot edit content or its own record;
 * persisting the result is the harness's job.
 */
export function buildTools(opts: {
  subject: ReviewSubject;
  evidence: EvidenceLedger;
  maxWebSearches: number;
  onAccept: (a: AcceptedSubmission) => void;
}): { tools: AgentTool[]; serverTools: Anthropic.Beta.BetaToolUnion[] } {
  return {
    tools: [
      readSource,
      searchSource,
      lookupDoi,
      searchEuropePmc,
      getEuropePmcFullText,
      getArxivAbstract,
      findArchivedCopy,
      createSubmitTool(opts.subject, opts.evidence, opts.onAccept),
    ] as AgentTool[],
    // Server-side search, for locating sources and dissenting scholarship. Its
    // results are leads: claims must be checked by reading a document with read_source.
    serverTools: opts.maxWebSearches > 0 ? [{ type: "web_search_20260209", name: "web_search", max_uses: opts.maxWebSearches }] : [],
  };
}
