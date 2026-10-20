import assert from "node:assert/strict";
import { test } from "node:test";
import { checkContent, contentHash, entryToMarkdown, eventFromMarkdown, ideaFromMarkdown } from "../../src/content/rules.ts";
import type { Bibliography, Emergence, HistoricalEvent, Idea, IdeaLink, ReviewRecord } from "../../src/content/schema.ts";
import { entryToProps, propsToEvent, propsToIdea, propsToSource, sourceToProps } from "../src/mapping.ts";

const bib: Bibliography = {
  "lam-2010": {
    type: "secondary", kind: "chapter", authors: ["Joseph Lam"], editors: ["Christopher Woods"], translators: [], etAl: false, consulted: true,
    title: "The Invention and Development of the Alphabet", container: "Visible Language", publisher: "OI", year: 2010, pages: "pp. 189–195",
  },
};

const idea = (over: Partial<Idea> = {}): Idea => ({
  id: "alphabet", title: "The Alphabet", category: "technology", status: "sourced",
  date: { year: -1850, approx: true, marks: "Earliest inscriptions", note: "Uncertain [@lam-2010, p. 189]." },
  origin: "Egypt and Sinai", summary: "Semitic speakers invent the alphabet.", aliases: ["abjad"], sources: ["lam-2010"],
  body: "Invented in the Egyptian realm [@lam-2010, p. 190].", ...over,
});
const writing = idea({ id: "writing", title: "Writing", date: { year: -3200, approx: true, marks: "Uruk IV" }, aliases: [] });

const seed = (over: Partial<IdeaLink> = {}): IdeaLink => ({ from: "alphabet", to: "writing", type: "BUILDS_ON", origin: "seed", status: "proposed", ...over });
const event = (over: Partial<HistoricalEvent> = {}): HistoricalEvent => ({
  id: "wadi-el-hol-inscriptions", title: "Wadi el-Hol inscriptions carved", kind: "cultural", status: "sourced",
  date: { year: -1850, approx: true, marks: "Estimated date of the inscriptions", earliest: -1900, latest: -1800 },
  place: "Wadi el-Hol, Egypt", summary: "Short alphabetic inscriptions are carved on a desert route.", aliases: [], sources: ["lam-2010"],
  body: "> the earliest alphabetic inscriptions [@lam-2010, p. 190]", ...over,
});
const emergence = (over: Partial<Emergence> = {}): Emergence => ({
  idea: "alphabet", event: "wadi-el-hol-inscriptions", stage: "earliest-evidence", why: "Earliest alphabetic writing.", status: "proposed",
  evidence: "x", evidenceUrl: "https://x.example", confidence: "high", ...over,
});
const check = (ideas: Idea[], links: IdeaLink[] = [], reviews = new Map<string, ReviewRecord>(), events: HistoricalEvent[] = [], emergences: Emergence[] = []) =>
  checkContent({ ideas, events, bibliography: bib, links, emergences, latestReviews: reviews });

test("valid content passes", () => {
  assert.deepEqual(check([idea(), writing], [seed()]), []);
});

test("link rules: existence, direction, candidates, linker evidence", () => {
  const p = check(
    [idea(), writing, idea({ id: "cand", status: "candidate", title: "C" })],
    [
      seed({ from: "writing", to: "alphabet" }), // forward in time
      seed({ to: "nope" }),
      seed({ to: "cand" }),
      seed({ origin: "linker" }), // no evidence
      seed({ type: "PARALLELS", from: "writing", to: "alphabet" }), // parallels may point either way in time? no: only directional types are checked
    ],
  );
  for (const expected of ["points forward in time", "nope does not exist", "candidate ideas cannot be linked", "linker links need a why, evidence and evidenceUrl"]) {
    assert.ok(p.some((x) => x.includes(expected)), `${expected}\n${p.join("\n")}`);
  }
  assert.ok(!p.some((x) => x.includes("-PARALLELS->") && x.includes("forward")), "PARALLELS isn't directional");
});

test("a reviewed idea needs a matching passing review record", () => {
  const hash = contentHash(idea(), bib);
  const reviewed = idea({ status: "reviewed", review: { by: "fact-checker", date: "2026-10-20", hash } });
  const pass: ReviewRecord = { runId: "r1", label: "Idea", id: "alphabet", verdict: "pass", mode: "full", by: "fact-checker", date: "2026-10-20", hash, report: "" };
  assert.deepEqual(check([reviewed, writing], [], new Map([["Idea:alphabet", pass]])), []);
  assert.ok(check([reviewed, writing]).some((x) => x.includes("no passing review record")));
  assert.ok(check([reviewed, writing], [], new Map([["Idea:alphabet", { ...pass, verdict: "fail" }]])).some((x) => x.includes("no passing review record")));
  assert.ok(check([reviewed, writing], [], new Map([["Event:alphabet", pass]])).some((x) => x.includes("no passing review record")), "an event's review doesn't count for an idea");
  const edited = { ...reviewed, summary: "Changed." };
  assert.ok(check([edited, writing], [], new Map([["Idea:alphabet", pass]])).some((x) => x.includes("changed since it was reviewed")));
  assert.ok(check([reviewed, writing], [], new Map([["Idea:alphabet", { ...pass, mode: "check" }]])).some((x) => x.includes("no passing review record")), "a check doesn't make an entry reviewed");
});

test("a checked entry needs a matching passing check record", () => {
  const hash = contentHash(event(), bib);
  const checked = event({ status: "checked", review: { by: "fact-checker", date: "2026-10-20", hash } });
  const pass: ReviewRecord = { runId: "c1", label: "Event", id: checked.id, verdict: "pass", mode: "check", by: "fact-checker", date: "2026-10-20", hash, report: "" };
  assert.deepEqual(check([idea(), writing], [], new Map([[`Event:${checked.id}`, pass]]), [checked]), []);
  assert.ok(check([idea(), writing], [], new Map([[`Event:${checked.id}`, { ...pass, mode: "full" }]]), [checked]).some((x) => x.includes("no passing check record")));
  assert.ok(check([idea(), writing], [], new Map(), [checked]).some((x) => x.includes("no passing check record")));
});

test("aliases and status don't affect the content hash; content does", () => {
  const h = contentHash(idea(), bib);
  assert.equal(contentHash(idea({ aliases: ["other"], status: "draft" }), bib), h);
  assert.notEqual(contentHash(idea({ summary: "Different." }), bib), h);
  assert.notEqual(contentHash(idea(), { "lam-2010": { ...bib["lam-2010"], pages: "pp. 189–196" } }), h);
});

test("the editing format round-trips, and omits the review record", () => {
  const original = idea({ status: "reviewed", review: { by: "fact-checker", date: "2026-10-20", hash: "0123456789abcdef" } });
  const md = entryToMarkdown(original);
  assert.doesNotMatch(md, /review:/);
  const back = ideaFromMarkdown(md);
  assert.deepEqual({ ...back, review: original.review }, original);
});

test("events follow the same entry rules as ideas", () => {
  assert.deepEqual(check([idea(), writing], [], new Map(), [event()]), []);
  const p = check([idea(), writing], [], new Map(), [event({ date: { year: -1850, approx: true }, body: "No citation." })]);
  for (const e of ["requires saying what the date marks", "requires at least one [@citation]", '"lam-2010" is listed but never cited']) {
    assert.ok(p.some((x) => x.startsWith("event wadi-el-hol-inscriptions") && x.includes(e)), `${e}\n${p.join("\n")}`);
  }
});

test("emergence rules: both ends exist, no duplicates, known sources", () => {
  assert.deepEqual(check([idea(), writing], [], new Map(), [event()], [emergence()]), []);
  const p = check([idea(), writing], [], new Map(), [event()], [emergence(), emergence(), emergence({ idea: "nope" }), emergence({ event: "gone" }), emergence({ idea: "writing", sourceKey: "missing" })]);
  for (const e of ["listed twice", "idea nope does not exist", "event gone does not exist", 'unknown source "missing"']) {
    assert.ok(p.some((x) => x.includes(e)), `${e}\n${p.join("\n")}`);
  }
});

test("the event editing format and graph mapping round-trip", () => {
  const original = event();
  assert.deepEqual(eventFromMarkdown(entryToMarkdown(original)), original);
  const back = propsToEvent(structuredClone(entryToProps(original)) as Record<string, unknown>, original.sources);
  assert.deepEqual(back, original);
  assert.equal(contentHash(back, bib), contentHash(original, bib));
});

test("graph mapping round-trips ideas and sources with identical hashes", () => {
  const original = idea();
  const props = structuredClone(entryToProps(original)) as Record<string, unknown>;
  const back = propsToIdea(props, original.sources);
  const { props: sprops, people } = sourceToProps(bib["lam-2010"]);
  const source = propsToSource({ ...structuredClone(sprops), key: "lam-2010" }, people);
  assert.deepEqual(back, original);
  assert.equal(contentHash(back, { "lam-2010": source }), contentHash(original, bib));
});
