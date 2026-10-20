import Anthropic from "@anthropic-ai/sdk";
import { estimateCost } from "./config.ts";
import { clip, type RunLog } from "./log.ts";
import { toApiTool, ToolError, type AgentTool, type ToolContext } from "./tools/types.ts";

type Message = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export interface LoopOptions {
  client: Anthropic;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  fallback: "default" | "off";
  system: string;
  prompt: string;
  /** Client-side tools, run by this process. */
  tools: AgentTool[];
  /** Server-side tools (e.g. web search), run by the API. */
  serverTools: Anthropic.Beta.BetaToolUnion[];
  maxTurns: number;
  maxUsd: number;
  ctx: ToolContext;
  log: RunLog;
  /** True once the agent has produced its result; the loop stops before the next request. */
  isDone: () => boolean;
  /** Sent if the agent stops without finishing. */
  nudge: string;
}

export interface LoopResult {
  stopped: "done" | "turn-limit" | "budget" | "gave-up";
  turns: number;
  costUsd: number;
  /** Models that actually served responses (differs from the requested one after a refusal fallback). */
  servedBy: string[];
}

export class RefusalError extends Error {
  constructor(details: unknown) {
    super(`the model declined the request: ${JSON.stringify(details)}`);
    this.name = "RefusalError";
  }
}

/**
 * A manual agent loop: request, run the requested tools, send back the results,
 * repeat until the agent produces its result or a limit is hit.
 *
 * - Append-only history (assistant turns are sent back unchanged, thinking blocks
 *   included), so prompt caching and thinking continuity hold.
 * - Every stop reason is handled explicitly: tool_use, pause_turn (server tools
 *   paused), end_turn without a result (nudge, then give up), max_tokens and
 *   refusal (fail loudly rather than act on a truncated or declined turn).
 * - Turn and spend limits are checked before each request, with a warning to the
 *   agent at 80% so it can wrap up.
 * - Tool inputs are validated against their schema before running; tool failures
 *   go back to the agent as error results instead of crashing the run.
 */
export async function runAgentLoop(o: LoopOptions): Promise<LoopResult> {
  const apiTools: Anthropic.Beta.BetaToolUnion[] = [...o.tools.map(toApiTool), ...o.serverTools];
  const tools = new Map(o.tools.map((t) => [t.name, t]));
  const messages: Message[] = [{ role: "user", content: o.prompt }];
  const servedBy = new Set<string>();
  let turns = 0;
  let costUsd = 0;
  let nudges = 0;
  let warned = false;
  let jsonRetries = 0;

  const result = (stopped: LoopResult["stopped"]): LoopResult => ({ stopped, turns, costUsd, servedBy: [...servedBy] });

  while (true) {
    if (o.isDone()) return result("done");
    if (turns >= o.maxTurns) return result("turn-limit");
    if (costUsd >= o.maxUsd) return result("budget");
    turns++;

    const stream = o.client.beta.messages.stream(
      {
        model: o.model,
        max_tokens: 64_000,
        system: o.system,
        tools: apiTools,
        messages,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: o.effort },
        cache_control: { type: "ephemeral" },
        ...(o.fallback === "default" ? { fallbacks: "default" as const, betas: ["server-side-fallback-2026-07-01"] } : {}),
      },
      { signal: o.ctx.signal },
    );

    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await stream.finalMessage();
      jsonRetries = 0;
    } catch (e) {
      // With eager input streaming, a tool input that isn't parseable JSON rejects here.
      // Re-issue that turn (bounded); API errors, aborts and everything else propagate.
      if (e instanceof Anthropic.APIError || o.ctx.signal.aborted || jsonRetries++ >= 2) throw e;
      o.log.event("unparseable_tool_input", { turn: turns, error: String(e) });
      turns--;
      continue;
    }

    servedBy.add(msg.model);
    costUsd += estimateCost(msg.model, msg.usage);
    o.log.event("response", { turn: turns, model: msg.model, stop_reason: msg.stop_reason, usage: msg.usage, content: msg.content });

    if (msg.stop_reason === "refusal") throw new RefusalError(msg.stop_details);
    messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });

    if (msg.stop_reason === "pause_turn") continue; // a server tool paused; resend to resume
    if (msg.stop_reason === "max_tokens") throw new Error(`turn ${turns} hit max_tokens; refusing to act on a truncated response`);

    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const searches = msg.content.filter((b) => b.type === "server_tool_use").length;
    o.log.progress(
      `turn ${turns} · $${costUsd.toFixed(2)} · ` +
        ([...calls.map((c) => describeCall(c)), ...(searches ? [`web_search ×${searches}`] : [])].join(", ") || msg.stop_reason),
    );

    if (calls.length) {
      // Run this turn's tool calls concurrently and return all results in one message.
      const content: Anthropic.Beta.BetaContentBlockParam[] = await Promise.all(calls.map((c) => runTool(c, tools, o)));
      if (!warned && (costUsd >= 0.8 * o.maxUsd || turns >= 0.8 * o.maxTurns)) {
        warned = true;
        content.push({ type: "text", text: "Budget notice: you are close to this review's turn or spend limit. Finish checking and call submit_review soon." });
      }
      messages.push({ role: "user", content });
      continue;
    }

    // The agent ended its turn without calling a tool.
    if (o.isDone()) return result("done");
    if (nudges++ >= 2) return result("gave-up");
    messages.push({ role: "user", content: o.nudge });
  }
}

async function runTool(call: Anthropic.Beta.BetaToolUseBlock, tools: Map<string, AgentTool>, o: LoopOptions): Promise<ToolResult> {
  const fail = (content: string): ToolResult => ({ type: "tool_result", tool_use_id: call.id, is_error: true, content });
  const tool = tools.get(call.name);
  if (!tool) return fail(`Unknown tool: ${call.name}`);

  // Streamed tool inputs aren't validated by the API; validate before running.
  const parsed = tool.input.safeParse(call.input);
  if (!parsed.success) {
    o.log.event("tool_invalid_input", { tool: call.name, input: call.input, issues: parsed.error.issues });
    return fail(JSON.stringify({ INVALID_INPUT: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }));
  }

  try {
    const output = await tool.run(parsed.data, o.ctx);
    o.log.event("tool_result", { tool: call.name, input: call.input, output: clip(output) });
    return { type: "tool_result", tool_use_id: call.id, content: output };
  } catch (e) {
    if (o.ctx.signal.aborted) throw e;
    const expected = e instanceof ToolError;
    o.log.event("tool_error", { tool: call.name, input: call.input, error: String(e), expected });
    return fail(expected ? (e as Error).message : `Internal error in ${call.name}: ${(e as Error).message}`);
  }
}

function describeCall(c: Anthropic.Beta.BetaToolUseBlock): string {
  const input = c.input as Record<string, unknown>;
  const arg = input.url ?? input.query ?? input.doi ?? input.id ?? input.pmcid ?? (c.name === "submit_review" ? input.verdict : "");
  return `${c.name}(${clip(String(arg ?? ""), 70)})`;
}
