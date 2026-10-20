import { createHash } from "node:crypto";
import type { Driver } from "neo4j-driver";
import { contentHash, entryKey } from "../../src/content/rules.ts";
import { labelOf, type EntryLabel, type HistoricalEvent } from "../../src/content/schema.ts";
import { loadContent } from "../../kg/src/repository.ts";
import { authorTask } from "../author/author.ts";
import type { Period } from "../core/period.ts";
import { CHECK_BATCH, checkable } from "../fact-checker/check.ts";

// What each item in the graph needs next, worked out from the graph itself:
// statuses, content hashes, review records and AgentRun history. The plan is
// recomputed after every task, so each stage's output feeds the next.
//
// Events take the cheap path: find documents for a period → harvest every dated
// event from them (about a tenth of a cent each) → batch check (about half a
// cent each) → on a fail, a light revision within their excerpts (about 2 cents)
// → check again. A deterministic sample of checked events also gets a full
// review, to measure what the batch check misses. Ideas (with --ideas) take the
// full path. The older agent gatherer runs only when asked for (--only gather).

export const STAGES = ["review", "revise", "check", "link", "author", "interpret", "harvest", "find", "gather"] as const;
export type Stage = (typeof STAGES)[number];

/** Stages that only concern ideas; the pipeline skips them unless asked to include ideas. */
export const IDEA_STAGES: Stage[] = ["link", "author", "interpret"];
/** Stages that run only when named in --only. */
export const ON_REQUEST: Stage[] = ["gather"];
/** Sources per harvest task (one Batch API job with --batch). */
const HARVEST_TASK = 25;

/** Share of checked events that also get a full review. */
export const DEFAULT_SAMPLE = 0.05;
/** Light revisions to try after failed checks before escalating to a full revision. */
const LIGHT_ATTEMPTS = 2;

export type Task =
  | { stage: "gather" | "find"; period: Period }
  | { stage: "harvest"; keys: string[] }
  | { stage: "interpret"; period: Period }
  | { stage: "check"; ids: string[] }
  | { stage: "author"; label: EntryLabel; id: string; why: string }
  | { stage: "revise"; label: EntryLabel; id: string; why: string; light: boolean }
  | { stage: "link"; id: string }
  | { stage: "review"; label: EntryLabel; id: string; why: string };

export function taskKey(t: Task): string {
  if ("period" in t) return `${t.stage}:${t.period.from}:${t.period.to}`;
  if ("ids" in t) return `${t.stage}:${t.ids.join(",")}`;
  if ("keys" in t) return `${t.stage}:${t.keys.join(",")}`;
  return `${t.stage}:${"label" in t ? t.label : "Idea"}:${t.id}`;
}

/** Whether an event is in the full-review sample: a stable function of its id. */
export function sampled(id: string, rate: number): boolean {
  return parseInt(createHash("sha256").update(id).digest("hex").slice(0, 8), 16) / 0xffffffff < rate;
}

/**
 * Default window for gathering: wide where the record is sparse, narrow where
 * it's dense. A first guess, to be tuned as coverage grows.
 */
export function windowSize(year: number): number {
  if (year < -1_000_000) return 500_000;
  if (year < -300_000) return 100_000;
  if (year < -100_000) return 25_000;
  if (year < -50_000) return 10_000;
  if (year < -10_000) return 2_500;
  if (year < -4_000) return 500;
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
  mode: string | null;
  light: number | null;
}

export interface Plan {
  tasks: Task[];
  /** Estimated cost of a task, from the average of past runs like it. */
  cost: (t: Task) => number;
}

// Rough per-task costs used until there's history to average.
const DEFAULT_COST = { review: 0.6, revise: 0.8, light: 0.02, check: 0.03, link: 0.15, author: 0.8, interpret: 0.8, gather: 1.2, find: 0.08, harvest: 0.01 };

export async function planWork(driver: Driver, opts: { periods: Period[]; stages?: Stage[]; ideas?: boolean; sample?: number }): Promise<Plan> {
  const content = await loadContent(driver);
  const sample = opts.sample ?? DEFAULT_SAMPLE;
  const q = async (cypher: string) => (await driver.executeQuery(cypher)).records.map((r) => r.toObject());
  const runs = (await q(
    `MATCH (r:AgentRun) OPTIONAL MATCH (r)-[:ABOUT]->(t)
     RETURN r.agent AS agent, r.outcome AS outcome, toString(r.createdAt) AS createdAt, r.from AS from, r.to AS to, r.mode AS mode, r.light AS light,
            CASE WHEN t IS NULL THEN null ELSE head(labels(t)) + ":" + coalesce(t.id, t.key) END AS about, r.costUsd AS costUsd`,
  )) as RunRow[];
  const updated = new Map(
    (await q(`MATCH (n) WHERE n:Idea OR n:Event RETURN head(labels(n)) + ":" + n.id AS key, toString(n.updatedAt) AS at`)).map((r) => [r.key as string, (r.at as string | null) ?? ""]),
  );
  const created = new Map((await q(`MATCH (e:Event) RETURN e.id AS id, toString(e.createdAt) AS at`)).map((r) => [r.id as string, (r.at as string | null) ?? ""]));
  // Full reviews of an entry's current content (the latest record may be a check).
  const fullReviews = new Set(
    (await q(`MATCH (r:Review)-[:REVIEWS]->(n) WHERE coalesce(r.mode, "full") = "full" RETURN head(labels(n)) + ":" + n.id + ":" + r.hash AS k`)).map((r) => r.k as string),
  );

  const lastRun = (agent: string, about: string) =>
    runs.filter((r) => r.agent === agent && r.about === about).reduce((max, r) => (r.createdAt > max ? r.createdAt : max), "");
  const covers = (r: RunRow, p: Period) => r.from !== null && r.to !== null && r.from <= p.from && r.to >= p.to;
  const tasks: Task[] = [];
  const toCheck: HistoricalEvent[] = [];

  for (const entry of opts.ideas ? [...content.events, ...content.ideas] : content.events) {
    const label = labelOf(entry);
    const key = entryKey(label, entry.id);
    const sources = Object.fromEntries(entry.sources.map((k) => [k, content.bibliography[k]]));
    const hash = contentHash(entry, sources);
    const record = content.latestReviews.get(key);
    const task = authorTask(entry, record, hash);
    const lastAuthored = lastRun("author", key);
    const authoredSince = lastAuthored !== "" && lastAuthored >= [updated.get(key) ?? "", record?.createdAt ?? ""].sort().at(-1)!;
    const isEvent = label === "Event";

    if (task === "revise") {
      if (!authoredSince) {
        const lightTries = runs.filter((r) => r.agent === "author" && r.about === key && r.light === 1).length;
        const light = record?.mode === "check" && lightTries < LIGHT_ATTEMPTS;
        tasks.push({ stage: "revise", label, id: entry.id, why: `failed ${record?.mode === "check" ? "check" : "review"}`, light });
      }
    } else if (entry.status === "sourced" && (!record || record.hash !== hash)) {
      if (isEvent && checkable(entry as HistoricalEvent)) toCheck.push(entry as HistoricalEvent);
      else tasks.push({ stage: "review", label, id: entry.id, why: isEvent ? "no quoted excerpts to batch-check" : record ? "changed since its last review" : "never reviewed" });
    } else if (isEvent && entry.status === "checked" && sampled(entry.id, sample) && !fullReviews.has(`${key}:${hash}`)) {
      tasks.push({ stage: "review", label, id: entry.id, why: "in the full-review sample" });
    } else if ((task === "curate" || task === "source") && !authoredSince) {
      tasks.push({ stage: "author", label, id: entry.id, why: task === "curate" ? "uncurated candidate" : "unsourced draft" });
    }
  }
  for (let i = 0; i < toCheck.length; i += CHECK_BATCH) tasks.push({ stage: "check", ids: toCheck.slice(i, i + CHECK_BATCH).map((e) => e.id) });

  // link: sourced or verified ideas not linked since they last changed.
  if (opts.ideas) {
    for (const idea of content.ideas) {
      if (idea.status === "candidate" || idea.status === "draft") continue;
      const key = entryKey("Idea", idea.id);
      const lastLinked = lastRun("linker", key);
      if (!lastLinked || lastLinked < (updated.get(key) ?? "")) tasks.push({ stage: "link", id: idea.id });
    }
  }

  // harvest: sources the finder stored that haven't been harvested yet.
  const pending = (await q(`MATCH (s:Source {harvestStatus: "pending"}) RETURN s.key AS key ORDER BY coalesce(s.foundFor, ""), s.key`)).map((r) => r.key as string);
  for (let i = 0; i < pending.length; i += HARVEST_TASK) tasks.push({ stage: "harvest", keys: pending.slice(i, i + HARVEST_TASK) });

  // find / gather: requested windows with no successful finder (or gatherer) run covering them.
  // interpret: covered windows whose events changed since they were last interpreted.
  const searched = (agent: string) => runs.filter((r) => r.agent === agent && r.outcome === "saved");
  for (const p of opts.periods) {
    if (!searched("finder").some((r) => covers(r, p))) tasks.push({ stage: "find", period: p });
    if (!searched("gatherer").some((r) => covers(r, p))) tasks.push({ stage: "gather", period: p });
  }
  const gathered = [...searched("gatherer"), ...searched("finder")];
  const periods = [...opts.periods];
  for (const r of gathered) if (!periods.some((p) => p.from === r.from && p.to === r.to)) periods.push({ from: r.from!, to: r.to! });
  periods.sort((a, b) => a.from - b.from);
  for (const p of periods) {
    if (!gathered.some((r) => covers(r, p))) continue;
    if (!opts.ideas) continue;
    const events = content.events.filter((e) => e.date.year >= p.from && e.date.year <= p.to && e.status !== "candidate");
    if (!events.length) continue;
    const lastInterpreted = runs.filter((r) => r.agent === "interpreter" && covers(r, p)).reduce((max, r) => (r.createdAt > max ? r.createdAt : max), "");
    const lastChange = events.flatMap((e) => [updated.get(entryKey("Event", e.id)) ?? "", created.get(e.id) ?? ""]).sort().at(-1) ?? "";
    if (lastInterpreted < lastChange) tasks.push({ stage: "interpret", period: p });
  }

  const avg = (rows: RunRow[], fallback: number) => {
    const costs = rows.map((r) => r.costUsd ?? 0).filter((c) => c > 0);
    return costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : fallback;
  };
  const reviewCosts = [...content.latestReviews.values()].filter((r) => r.mode === "full").map((r) => Number(/est_cost_usd: ([\d.]+)/.exec(r.report)?.[1])).filter((n) => n > 0);
  const est = {
    review: reviewCosts.length ? reviewCosts.reduce((a, b) => a + b, 0) / reviewCosts.length : DEFAULT_COST.review,
    revise: avg(runs.filter((r) => r.agent === "author" && r.light !== 1), DEFAULT_COST.revise),
    light: avg(runs.filter((r) => r.agent === "author" && r.light === 1), DEFAULT_COST.light),
    check: avg(runs.filter((r) => r.agent === "fact-checker" && r.mode === "check"), DEFAULT_COST.check),
    link: avg(runs.filter((r) => r.agent === "linker"), DEFAULT_COST.link),
    author: avg(runs.filter((r) => r.agent === "author" && r.light !== 1), DEFAULT_COST.author),
    interpret: avg(runs.filter((r) => r.agent === "interpreter"), DEFAULT_COST.interpret),
    gather: avg(runs.filter((r) => r.agent === "gatherer"), DEFAULT_COST.gather),
    find: avg(runs.filter((r) => r.agent === "finder"), DEFAULT_COST.find),
    harvest: avg(runs.filter((r) => r.agent === "harvester"), DEFAULT_COST.harvest),
  };
  const cost = (t: Task) => (t.stage === "revise" && t.light ? est.light : t.stage === "harvest" ? est.harvest * t.keys.length : est[t.stage]);

  const stages = new Set(opts.stages ?? STAGES.filter((s) => !ON_REQUEST.includes(s)));
  const wanted = (t: Task) => stages.has(t.stage) && (opts.ideas || !IDEA_STAGES.includes(t.stage));
  const order = (t: Task) => STAGES.indexOf(t.stage);
  return { tasks: tasks.filter(wanted).sort((a, b) => order(a) - order(b)), cost };
}
