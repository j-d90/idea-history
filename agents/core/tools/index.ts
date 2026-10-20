import type Anthropic from "@anthropic-ai/sdk";
import { readSource, searchSource } from "./documents.ts";
import { findArchivedCopy, getArxivAbstract, getEuropePmcFullText, lookupDoi, searchEuropePmc } from "./scholarly.ts";
import type { AgentTool } from "./types.ts";

/** Tools for reading and checking sources, shared by every agent. */
export const sourceTools = [readSource, searchSource, lookupDoi, searchEuropePmc, getEuropePmcFullText, getArxivAbstract, findArchivedCopy] as AgentTool[];

/**
 * Server-side web search, for locating sources and dissenting scholarship. Its
 * results are leads only: evidence must come from a document read with read_source.
 */
export function webSearch(maxUses: number): Anthropic.Beta.BetaToolUnion[] {
  return maxUses > 0 ? [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses }] : [];
}
