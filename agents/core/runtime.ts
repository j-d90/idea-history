import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Driver, ManagedTransaction } from "neo4j-driver";
import { connect, neo4jConfigFromEnv } from "../../kg/src/driver.ts";
import { Embedder, refreshEmbeddings } from "../../kg/src/embeddings.ts";
import { loadConfig, type Config } from "./config.ts";
import { EvidenceLedger } from "./evidence.ts";
import { RunLog } from "./log.ts";
import type { LoopResult } from "./loop.ts";

/** Everything an agent CLI needs: configuration, API clients, the graph, and cancellation. */
export interface Runtime {
  config: Config;
  client: Anthropic;
  driver: Driver;
  embedder: Embedder;
  signal: AbortSignal;
  close(): Promise<void>;
}

export async function openRuntime(): Promise<Runtime> {
  const config = loadConfig();
  const driver = await connect(neo4jConfigFromEnv());
  const embedder = new Embedder();
  // Ctrl-C aborts in-flight requests and tool calls; aborted runs record nothing.
  const controller = new AbortController();
  process.once("SIGINT", () => {
    console.error("\nAborting…");
    controller.abort();
  });
  // Lookups need current vectors for everything in the graph.
  await refreshEmbeddings(driver, embedder);
  return {
    config,
    client: new Anthropic({ maxRetries: 4 }),
    driver,
    embedder,
    signal: controller.signal,
    close: () => driver.close(),
  };
}

/** Per-run state: an id, the transcript log, the evidence ledger. */
export interface Run {
  id: string;
  agent: string;
  today: string;
  log: RunLog;
  evidence: EvidenceLedger;
}

export function startRun(agent: string, target: string): Run {
  const today = new Date().toISOString().slice(0, 10);
  const id = `${today}-${agent}-${target}-${randomBytes(3).toString("hex")}`;
  return { id, agent, today, log: new RunLog(id), evidence: new EvidenceLedger() };
}

export async function withWrite<T>(driver: Driver, fn: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  const session = driver.session();
  try {
    return await session.executeWrite(fn);
  } finally {
    await session.close();
  }
}

export async function withRead<T>(driver: Driver, fn: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  const session = driver.session();
  try {
    return await session.executeRead(fn);
  } finally {
    await session.close();
  }
}

/**
 * Record an agent run in the graph, attached to what it worked on (`about`), or
 * described by `props` when it worked on something that isn't a node, such as a
 * period of time.
 */
export async function recordAgentRun(
  tx: ManagedTransaction,
  run: Run,
  r: {
    model: string;
    loop: LoopResult;
    outcome: string;
    summary: string;
    about?: { label: "Idea" | "Event" | "Source"; key: string };
    props?: Record<string, string | number>;
  },
): Promise<void> {
  const keyField = r.about?.label === "Source" ? "key" : "id";
  await tx.run(
    `CREATE (a:AgentRun {runId: $runId, agent: $agent, date: $date, model: $model, servedBy: $servedBy,
                         turns: $turns, costUsd: $cost, outcome: $outcome, summary: $summary, createdAt: datetime()})
     SET a += $props
     WITH a
     OPTIONAL MATCH (target:${r.about?.label ?? "Idea"} {${keyField}: $key})
     FOREACH (t IN CASE WHEN target IS NULL THEN [] ELSE [target] END | CREATE (a)-[:ABOUT]->(t))`,
    {
      key: r.about?.key ?? null,
      props: r.props ?? {},
      runId: run.id,
      agent: run.agent,
      date: run.today,
      model: r.model,
      servedBy: r.loop.servedBy,
      turns: r.loop.turns,
      cost: Number(r.loop.costUsd.toFixed(4)),
      outcome: r.outcome,
      summary: r.summary,
    },
  );
}
