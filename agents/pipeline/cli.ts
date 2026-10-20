// Plan or run the content pipeline. Usage:
//   npm run pipeline -- [--from <year> --to <year> [--step <years>]] [--only <stages>]   show the plan (free)
//   npm run pipeline -- ... --run --budget <usd> [--limit <tasks>]                       run it
//
// By default only events are processed: gather, batch check, light revision after a
// failed check, and a full review for a sample of checked events (--sample, default
// 0.05). --ideas adds the idea stages (interpret, author, link) and idea reviews.
// Stages run in this order: review, revise, check, link, author, interpret, gather
// (downstream first, so the budget finishes entries before starting new ones).
// --from/--to add gathering windows for that range (years negative for BCE, or
// like 2500bce); periods gathered before are always considered for interpretation.
import { parseArgs } from "node:util";
import { connect, neo4jConfigFromEnv } from "../../kg/src/driver.ts";
import { authorEntry } from "../author/author.ts";
import { joinNegativeValues, parseYear } from "../core/args.ts";
import { openRuntime, type Runtime } from "../core/runtime.ts";
import { fmtYear } from "../core/tools/graph.ts";
import { checkEvents } from "../fact-checker/check.ts";
import { reviewEntry } from "../fact-checker/review.ts";
import { gather } from "../gatherer/gather.ts";
import { events } from "../gatherer/observations/events.ts";
import { interpretPeriod } from "../interpreter/interpret.ts";
import { linkIdea } from "../linker/link.ts";
import { planWork, STAGES, taskKey, windows, type Stage, type Task } from "./plan.ts";

const USAGE = `usage:
  npm run pipeline -- [--from <year> --to <year> [--step <years>]] [--only <stages>] [--ideas] [--sample <0-1>]
  npm run pipeline -- ... --run --budget <usd> [--limit <tasks>]`;
const { values } = parseArgs({
  args: joinNegativeValues(process.argv.slice(2), ["--from", "--to"]),
  options: {
    from: { type: "string" },
    to: { type: "string" },
    step: { type: "string" },
    only: { type: "string" },
    run: { type: "boolean", default: false },
    budget: { type: "string" },
    limit: { type: "string" },
    ideas: { type: "boolean", default: false },
    sample: { type: "string" },
  },
});

const from = parseYear(values.from);
const to = parseYear(values.to);
const stages = values.only?.split(",").map((s) => s.trim()) as Stage[] | undefined;
const budget = values.budget ? Number(values.budget) : undefined;
const limit = values.limit ? Number(values.limit) : Infinity;
if ((values.from || values.to) && (from === undefined || to === undefined)) fail("--from and --to take years, e.g. -2500 or 2500bce");
if (stages?.some((s) => !STAGES.includes(s))) fail(`--only takes a comma-separated list of: ${STAGES.join(", ")}`);
if (values.run && !(budget && budget > 0)) fail("--run needs --budget <usd>, the most to spend on this run");
const periods = from !== undefined && to !== undefined ? windows(from, to, values.step ? Number(values.step) : undefined) : [];
const sample = values.sample !== undefined ? Number(values.sample) : undefined;
if (sample !== undefined && !(sample >= 0 && sample <= 1)) fail("--sample takes a share between 0 and 1, e.g. 0.05");
const planOpts = { periods, stages, ideas: values.ideas, sample };

function fail(message: string): never {
  console.log(`${message}\n\n${USAGE}`);
  process.exit(1);
}

const describe = (t: Task): string => {
  switch (t.stage) {
    case "gather":
    case "interpret":
      return `${fmtYear(t.period.from)} to ${fmtYear(t.period.to)}`;
    case "link":
      return t.id;
    case "check":
      return `${t.ids.length} event(s): ${t.ids.slice(0, 3).join(", ")}${t.ids.length > 3 ? ", …" : ""}`;
    case "revise":
      return `${t.label === "Event" ? "event:" : ""}${t.id} (${t.why}${t.light ? ", light" : ""})`;
    default:
      return `${t.label === "Event" ? "event:" : ""}${t.id} (${t.why})`;
  }
};

async function runTask(t: Task, rt: Runtime): Promise<{ costUsd: number; outcome: string }> {
  const out = (r: { costUsd: number; status: string; reason?: string }) => ({ costUsd: r.costUsd, outcome: r.status + (r.reason ? `: ${r.reason}` : "") });
  switch (t.stage) {
    case "gather":
      return out(await gather(events, t.period, rt));
    case "interpret":
      return out(await interpretPeriod(t.period, rt));
    case "check": {
      const r = await checkEvents(t.ids, rt);
      const n = (s: string) => r.outcomes.filter((o) => o.status === s).length;
      return { costUsd: r.costUsd, outcome: `${n("checked")} checked, ${n("failed")} failed, ${n("skipped")} skipped${r.reason ? ` (${r.reason})` : ""}` };
    }
    case "author":
      return out(await authorEntry(t.label, t.id, rt));
    case "revise":
      return out(await authorEntry(t.label, t.id, rt, { light: t.light }));
    case "link":
      return out(await linkIdea(t.id, rt));
    case "review": {
      const r = await reviewEntry(t.label, t.id, rt);
      return { costUsd: "costUsd" in r ? r.costUsd : 0, outcome: r.status + ("reason" in r ? `: ${r.reason}` : "") };
    }
  }
}

if (!values.run) {
  const driver = await connect(neo4jConfigFromEnv()).catch((e: Error) => fail(e.message));
  try {
    const plan = await planWork(driver, planOpts);
    if (!plan.tasks.length) console.log("Nothing to do.");
    let total = 0;
    for (const stage of STAGES) {
      const tasks = plan.tasks.filter((t) => t.stage === stage);
      if (!tasks.length) continue;
      const est = tasks.reduce((sum, t) => sum + plan.cost(t), 0);
      total += est;
      console.log(`\n${stage} (${tasks.length} task(s), about $${est.toFixed(2)})`);
      for (const t of tasks.slice(0, 15)) console.log(`  ${describe(t)}`);
      if (tasks.length > 15) console.log(`  … and ${tasks.length - 15} more`);
    }
    if (plan.tasks.length) {
      console.log(`\n${plan.tasks.length} task(s), about $${total.toFixed(2)} in model costs (estimates from past runs; web search fees extra).`);
      console.log("Each stage can create work for the next, so a full run costs more than this. Run with --run --budget <usd>.");
    }
  } finally {
    await driver.close();
  }
  process.exit(0);
}

const rt = await openRuntime();
const attempted = new Set<string>();
let spent = 0;
let done = 0;
try {
  while (done < limit && !rt.signal.aborted) {
    const plan = await planWork(rt.driver, planOpts);
    const next = plan.tasks.find((t) => !attempted.has(taskKey(t)));
    if (!next) {
      console.log("Nothing left to do.");
      break;
    }
    if (spent + plan.cost(next) > budget!) {
      console.log(`Stopping: the next task (${next.stage} ${describe(next)}, about $${plan.cost(next).toFixed(2)}) would likely exceed the budget.`);
      break;
    }
    attempted.add(taskKey(next));
    console.error(`\n[${done + 1}] ${next.stage} ${describe(next)} ($${spent.toFixed(2)} of $${budget!.toFixed(2)} spent)`);
    try {
      const r = await runTask(next, rt);
      spent += r.costUsd;
      console.log(`[${done + 1}] ${next.stage} ${describe(next)}: ${r.outcome} ($${r.costUsd.toFixed(2)})`);
    } catch (e) {
      if (rt.signal.aborted) break;
      console.log(`[${done + 1}] ${next.stage} ${describe(next)}: error: ${(e as Error).message}`);
    }
    done++;
  }
} finally {
  await rt.close();
}
console.log(`\n${done} task(s) run, about $${spent.toFixed(2)} spent.`);
