import type { Driver } from "neo4j-driver";
import { contentHash, entryKey } from "../../src/content/rules.ts";
import { labelOf, type EntryLabel } from "../../src/content/schema.ts";
import { loadContent } from "../../kg/src/repository.ts";
import { authorTask } from "../author/author.ts";
import type { Period } from "../core/period.ts";

// What each item in the graph needs next, worked out from the graph itself:
// statuses, content hashes, review records and AgentRun history. The plan is
// recomputed after every task, so each stage's output feeds the next.

export const STAGES = ["review", "revise", "link", "author", "interpret", "gather"] as const;
export type Stage = (typeof STAGES)[number];

export type Task =
  | { stage: "gather"; period: Period }
  | { stage: "interpret"; period: Period }
  | { stage: "author" | "revise"; label: EntryLabel; id: string; why: string }
  | { stage: "link"; id: string }
  | { stage: "review"; label: EntryLabel; id: string; why: string };

export const taskKey = (t: Task) => ("period" in t ? `${t.stage}:${t.period.from}:${t.period.to}` : `${t.stage}:${"label" in t ? t.label : "Idea"}:${t.id}`);

/**
 * Default window for gathering: wide where the record is sparse, narrow where
 * it's dense. A first guess, to be tuned as coverage grows.
 */
export function windowSize(year: number): number {
  if (year < -1000) return 100;
  if (year < 500) return 50;
  if (year < 1500) return 25;
  if (year < 1800) return 10;
  return 5;
}

/** Split a range into gathering windows. */
export function windows(from: number, to: number, step?: number): Period[] {
  const out: Period[] = [];
  for (let start = from; start <= to; ) {
    const size = step ?? windowSize(start);
    const end = Math.min(to, start + size - 1 + (start < 0 && start + size - 1 >= 0 ? 1 : 0));
    out.push({ from: start, to: end });
    start = end + 1 === 0 ? 1 : end + 1; // there is no year 0
  }
  return out;
}

interface RunRow {
  agent: string;
  outcome: string;
  createdAt: string;
  from: number | null;
  to: number | null;
  about: string | null;
  costUsd: number | null;
}

export interface Plan {
  tasks: Task[];
  /** Average cost per run by stage, from history (for estimates). */
  averageCost: Record<Stage, number>;
}

// Rough per-run costs used until there's history to average.
const DEFAULT_COST: Record<Stage, number> = { review: 0.6, revise: 0.8, link: 0.15, author: 0.8, interpret: 0.8, gather: 2.5 };
const STAGE_AGENT: Record<Stage, string> = { review: "fact-checker", revise: "author", link: "linker", author: "author", interpret: "interpreter", gather: "gatherer" };

export async function planWork(driver: Driver, opts: { periods: Period[]; stages?: Stage[] }): Promise<Plan> {
  const content = await loadContent(driver);
  const q = async (cypher: string) => (await driver.executeQuery(cypher)).records.map((r) => r.toObject());
  const runs = (await q(
    `MATCH (r:AgentRun) OPTIONAL MATCH (r)-[:ABOUT]->(t)
     RETURN r.agent AS agent, r.outcome AS outcome, toString(r.createdAt) AS createdAt, r.from AS from, r.to AS to,
            CASE WHEN t IS NULL THEN null ELSE head(labels(t)) + ":" + coalesce(t.id, t.key) END AS about, r.costUsd AS costUsd`,
  )) as RunRow[];
  const updated = new Map(
    (await q(`MATCH (n) WHERE n:Idea OR n:Event RETURN head(labels(n)) + ":" + n.id AS key, toString(n.updatedAt) AS at`)).map((r) => [r.key as string, (r.at as string | null) ?? ""]),
  );
  const created = new Map((await q(`MATCH (e:Event) RETURN e.id AS id, toString(e.createdAt) AS at, e.year AS year`)).map((r) => [r.id as string, r as { at: string | null; year: number }]));

  const lastRun = (agent: string, about: string) =>
    runs.filter((r) => r.agent === agent && r.about === about).reduce((max, r) => (r.createdAt > max ? r.createdAt : max), "");
  const covers = (r: RunRow, p: Period) => r.from !== null && r.to !== null && r.from <= p.from && r.to >= p.to;
  const stages = new Set(opts.stages ?? STAGES);
  const tasks: Task[] = [];

  // review: sourced entries whose current content has no review yet.
  // revise: sourced entries whose current content failed review (unless the author already tried since).
  // author: candidates and drafts (unless the author already ran on them since their last change).
  for (const entry of [...content.events, ...content.ideas]) {
    const label = labelOf(entry);
    const key = entryKey(label, entry.id);
    const sources = Object.fromEntries(entry.sources.map((k) => [k, content.bibliography[k]]));
    const hash = contentHash(entry, sources);
    const review = content.latestReviews.get(key);
    const task = authorTask(entry, review, hash);
    const lastAuthored = lastRun("author", key);
    const authoredSince = lastAuthored !== "" && lastAuthored >= [updated.get(key) ?? "", review?.createdAt ?? ""].sort().at(-1)!;

    if (entry.status === "sourced" && (!review || review.hash !== hash)) {
      tasks.push({ stage: "review", label, id: entry.id, why: review ? "changed since its last review" : "never reviewed" });
    } else if (task === "revise" && !authoredSince) {
      tasks.push({ stage: "revise", label, id: entry.id, why: "failed review" });
    } else if ((task === "curate" || task === "source") && !authoredSince) {
      tasks.push({ stage: "author", label, id: entry.id, why: task === "curate" ? "uncurated candidate" : "unsourced draft" });
    }
  }

  // link: sourced or reviewed ideas not linked since they last changed.
  for (const idea of content.ideas) {
    if (idea.status !== "sourced" && idea.status !== "reviewed") continue;
    const key = entryKey("Idea", idea.id);
    const lastLinked = lastRun("linker", key);
    if (!lastLinked || lastLinked < (updated.get(key) ?? "")) tasks.push({ stage: "link", id: idea.id });
  }

  // gather: requested windows with no successful gatherer run covering them.
  // interpret: gathered windows whose events changed since they were last interpreted.
  const gathered = runs.filter((r) => r.agent === "gatherer" && r.outcome === "saved");
  const periods = [...opts.periods];
  for (const r of gathered) if (!periods.some((p) => p.from === r.from && p.to === r.to)) periods.push({ from: r.from!, to: r.to! });
  periods.sort((a, b) => a.from - b.from);
  for (const p of periods) {
    if (!gathered.some((r) => covers(r, p))) {
      if (opts.periods.some((x) => x.from === p.from && x.to === p.to)) tasks.push({ stage: "gather", period: p });
      continue;
    }
    const events = content.events.filter((e) => e.date.year >= p.from && e.date.year <= p.to && e.status !== "candidate");
    if (!events.length) continue;
    const lastInterpreted = runs.filter((r) => r.agent === "interpreter" && covers(r, p)).reduce((max, r) => (r.createdAt > max ? r.createdAt : max), "");
    const lastChange = events.map((e) => [updated.get(entryKey("Event", e.id)) ?? "", created.get(e.id)?.at ?? ""]).flat().sort().at(-1) ?? "";
    if (lastInterpreted < lastChange) tasks.push({ stage: "interpret", period: p });
  }

  const averageCost = Object.fromEntries(
    STAGES.map((stage) => {
      const costs = stage === "review"
        ? [...content.latestReviews.values()].map((r) => Number(/est_cost_usd: ([\d.]+)/.exec(r.report)?.[1])).filter((n) => n > 0)
        : runs.filter((r) => r.agent === STAGE_AGENT[stage] && (r.costUsd ?? 0) > 0).map((r) => r.costUsd!);
      return [stage, costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : DEFAULT_COST[stage]];
    }),
  ) as Record<Stage, number>;

  const order = (t: Task) => STAGES.indexOf(t.stage);
  return { tasks: tasks.filter((t) => stages.has(t.stage)).sort((a, b) => order(a) - order(b)), averageCost };
}
