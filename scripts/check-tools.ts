// Check that the API accepts each agent's tool definitions. Strict tools are
// compiled into a grammar, which the API refuses when it gets too large; this
// finds that before a real run does. Costs a fraction of a cent.
// Usage: npm run check-tools
import Anthropic from "@anthropic-ai/sdk";
import type { Idea } from "../src/content/schema.ts";
import { loadConfig } from "../agents/core/config.ts";
import { EvidenceLedger } from "../agents/core/evidence.ts";
import { createRegisterSourceTool } from "../agents/core/sources.ts";
import { findSimilarEntities, findSimilarEvents, findSimilarIdeas, getEvent, getIdea, listEvents } from "../agents/core/tools/graph.ts";
import { sourceTools, webSearch } from "../agents/core/tools/index.ts";
import { toApiTool, type AgentTool } from "../agents/core/tools/types.ts";
import { createSubmitEntryTool } from "../agents/author/schema.ts";
import { createSubmitExtractionTool } from "../agents/extractor/schema.ts";
import { createSubmitTool as createSubmitReviewTool } from "../agents/fact-checker/verdict.ts";
import { events } from "../agents/gatherer/observations/events.ts";
import { createSubmitTool as createSubmitObservationsTool } from "../agents/gatherer/schema.ts";
import { createSubmitInterpretationTool } from "../agents/interpreter/schema.ts";
import { createSubmitLinksTool } from "../agents/linker/schema.ts";
import { createSubmitSourcesTool } from "../agents/finder/schema.ts";
import { searchEuropePmc } from "../agents/core/tools/scholarly.ts";
import { harvestJsonSchema } from "../agents/harvester/schema.ts";

const evidence = new EvidenceLedger();
const none = () => false;
const noop = () => {};
const idea: Idea = { id: "x", title: "X", category: "technology", status: "draft", date: { year: 1, approx: false }, origin: "x", summary: "x", aliases: [], sources: [], body: "" };
const register = createRegisterSourceTool({ evidence, sourceExists: none, today: "2026-01-01" }, new Map());
const shared = [...sourceTools];

const agents: Record<string, AgentTool[]> = {
  gatherer: [...shared, listEvents, findSimilarEvents, getEvent, findSimilarEntities, register,
    createSubmitObservationsTool(events, { from: 0, to: 1, evidence, exists: none, entityExists: none, bibliography: {}, registry: new Map() }, noop, noop)] as AgentTool[],
  interpreter: [...shared, getEvent, listEvents, findSimilarIdeas, getIdea,
    createSubmitInterpretationTool({ evidence, events: new Map(), ideaExists: none, sourceExists: none }, noop, noop)] as AgentTool[],
  author: [...shared, getIdea, getEvent, findSimilarIdeas, register,
    createSubmitEntryTool({ current: idea, evidence, bibliography: {}, registry: new Map() }, noop, noop)] as AgentTool[],
  extractor: [...shared, findSimilarIdeas, findSimilarEntities, getIdea, createSubmitExtractionTool({ evidence, ideaExists: none, entityExists: none }, noop, noop)] as AgentTool[],
  linker: [...shared, findSimilarIdeas, getIdea,
    createSubmitLinksTool({ ideaId: "x", ideaYear: 0, evidence, mustConsider: [], lookup: () => undefined, sourceExists: none }, noop, noop)] as AgentTool[],
  finder: [searchEuropePmc, createSubmitSourcesTool(async () => ({ message: "", done: true }))] as AgentTool[],
  "fact-checker": [...shared, createSubmitReviewTool({ label: "Idea", entry: idea, sources: {}, hash: "0".repeat(16) }, evidence, noop)] as AgentTool[],
};

const { model, harvestModel } = loadConfig();
const client = new Anthropic();
let failed = false;
for (const [name, tools] of Object.entries(agents)) {
  try {
    await client.beta.messages.create({
      model,
      max_tokens: 16,
      tools: [...tools.map(toApiTool), ...webSearch(1)],
      messages: [{ role: "user", content: "Reply with the word ok. Don't call any tools." }],
    });
    console.log(`✓ ${name}`);
  } catch (e) {
    failed = true;
    console.log(`✗ ${name}: ${(e as Error).message}`);
  }
}
// The harvester uses structured output, not tools.
try {
  await client.messages.create({
    model: harvestModel,
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: harvestJsonSchema() } },
    messages: [{ role: "user", content: "Return an empty list of events." }],
  });
  console.log(`✓ harvester (${harvestModel})`);
} catch (e) {
  failed = true;
  console.log(`✗ harvester: ${(e as Error).message}`);
}
process.exit(failed ? 1 : 0);
