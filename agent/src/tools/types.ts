import type Anthropic from "@anthropic-ai/sdk";
import { toJSONSchema, type z } from "zod/v4";
import type { EvidenceLedger } from "../evidence.ts";

/** Per-run state shared by all tools. */
export interface ToolContext {
  evidence: EvidenceLedger;
  signal: AbortSignal;
}

/**
 * A client-side tool: a zod schema (the single source of truth for both the
 * JSON Schema sent to the API and runtime validation of what comes back) plus
 * a run function. Throw ToolError for failures the model should see and adapt to.
 */
export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  /** Say when to call it, not just what it does. */
  description: string;
  input: S;
  /** Constrain the model's arguments to the schema exactly (no numeric or length constraints allowed). */
  strict?: boolean;
  run(input: z.infer<S>, ctx: ToolContext): Promise<string>;
}

/** An expected failure, returned to the model as an error result rather than crashing the run. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool<S> {
  return tool;
}

/** The API definition for a tool. Streaming with eager input means the client validates inputs itself. */
export function toApiTool(tool: AgentTool): Anthropic.Beta.BetaTool {
  const { $schema: _ignored, ...schema } = toJSONSchema(tool.input, { target: "draft-7" }) as Record<string, unknown>;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
    eager_input_streaming: true,
    ...(tool.strict ? { strict: true } : {}),
  };
}
