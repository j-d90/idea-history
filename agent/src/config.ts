import { z } from "zod";

/**
 * All runtime configuration comes from the environment (loaded from .env by
 * `node --env-file-if-exists`). Validated once at startup so a bad value fails
 * fast with a readable message instead of midway through a paid run.
 */
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "is required (see .env.example)"),

  FACT_CHECKER_MODEL: z.string().default("claude-sonnet-5-5"),
  FACT_CHECKER_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  /** "default": on a safety-classifier refusal, the API retries on Anthropic's recommended fallback model. */
  FACT_CHECKER_FALLBACK: z.enum(["default", "off"]).default("default"),
  FACT_CHECKER_MAX_TURNS: z.coerce.number().int().positive().default(60),
  /** Hard stop on estimated model-token spend per review, in USD. */
  FACT_CHECKER_MAX_USD: z.coerce.number().positive().default(5),
  FACT_CHECKER_MAX_WEB_SEARCHES: z.coerce.number().int().nonnegative().default(10),

  REVIEW_STORE: z.enum(["files", "graph"]).default("files"),
  NEO4J_URI: z.string().default("bolt://localhost:7687"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().optional(),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  return {
    model: e.FACT_CHECKER_MODEL,
    effort: e.FACT_CHECKER_EFFORT,
    fallback: e.FACT_CHECKER_FALLBACK,
    maxTurns: e.FACT_CHECKER_MAX_TURNS,
    maxUsd: e.FACT_CHECKER_MAX_USD,
    maxWebSearches: e.FACT_CHECKER_MAX_WEB_SEARCHES,
    store: e.REVIEW_STORE,
    neo4j: { uri: e.NEO4J_URI, user: e.NEO4J_USER, password: e.NEO4J_PASSWORD },
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
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Estimated cost of one response. Unknown models are priced at the most expensive known rate. */
export function estimateCost(model: string, u: Usage): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5"];
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}
