import { z } from "zod";

/**
 * All runtime configuration comes from the environment (loaded from .env by
 * `node --env-file-if-exists`). Validated once at startup so a bad value fails
 * fast with a readable message instead of midway through a paid run.
 */
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "is required (see .env.example)"),

  AGENT_MODEL: z.string().default("claude-sonnet-5-5"),
  AGENT_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  /** "default": on a safety-classifier refusal, the API retries on Anthropic's recommended fallback model. */
  AGENT_FALLBACK: z.enum(["default", "off"]).default("default"),
  AGENT_MAX_TURNS: z.coerce.number().int().positive().default(60),
  /** Hard stop on estimated model-token spend per run, in USD. */
  AGENT_MAX_USD: z.coerce.number().positive().default(5),
  AGENT_MAX_WEB_SEARCHES: z.coerce.number().int().nonnegative().default(10),
  /** The model the harvester uses to extract events from documents: mechanical work, so the cheapest model. */
  HARVEST_MODEL: z.string().default("claude-haiku-5-5"),
});

export type Config = ReturnType<typeof loadConfig>;

/** Settings shared by every agent (model, effort, limits). Neo4j and embedding settings live in kg/. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  return {
    model: e.AGENT_MODEL,
    effort: e.AGENT_EFFORT,
    fallback: e.AGENT_FALLBACK,
    maxTurns: e.AGENT_MAX_TURNS,
    maxUsd: e.AGENT_MAX_USD,
    maxWebSearches: e.AGENT_MAX_WEB_SEARCHES,
    harvestModel: e.HARVEST_MODEL,
  };
}

/**
 * USD per million tokens, for the budget guard and the cost line in reports.
 * Covers the default model and the models a refusal fallback may route to.
 * Estimates only: web search is billed separately and is not included.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Prompts up to 100K tokens; the harvester keeps its chunks well under that.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Web search is billed per search, on top of tokens. */
export const WEB_SEARCH_USD = 0.01;

/**
 * Estimated cost of one response, including web searches. Unknown models are
 * priced at the most expensive known rate. Batch requests cost half.
 */
export function estimateCost(model: string, u: Usage & { server_tool_use?: { web_search_requests?: number } | null }, opts: { batch?: boolean } = {}): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5"];
  const tokens =
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000;
  return tokens * (opts.batch ? 0.5 : 1) + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}
