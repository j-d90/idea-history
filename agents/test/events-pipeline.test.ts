import assert from "node:assert/strict";
import { test } from "node:test";
import type { Idea, Source } from "../../src/content/schema.ts";
import { buildEntry, checkAuthorSubmission, type AuthorSubmission } from "../author/schema.ts";
import { joinNegativeValues, parseYear } from "../core/args.ts";
import { EvidenceLedger } from "../core/evidence.ts";
import { slugify } from "../core/slug.ts";
import { checkCitedExcerpt, checkNewSources, createRegisterSourceTool, type ProposedSource } from "../core/sources.ts";
import { events } from "../gatherer/observations/events.ts";
import { checkSubmission as checkGathering } from "../gatherer/schema.ts";
import { checkInterpretation, type Interpretation } from "../interpreter/schema.ts";
import { windows } from "../pipeline/plan.ts";

const URL = "https://museum.example/stele";
const QUOTE = "the stele records the victory of Eannatum over the neighbouring city of Umma";
function ledger() {
  const l = new EvidenceLedger();
  l.add({ url: URL, finalUrl: URL, kind: "html", text: `Notes. ${QUOTE}, about 2450 BCE. Other text.`, bytes: 1 });
  l.add({ url: "https://other.example", finalUrl: "https://other.example", kind: "html", text: "Unrelated page about pottery.", bytes: 1 });
  return l;
}
const proposed = (over: Partial<ProposedSource> = {}): ProposedSource => ({
  key: "louvre-ao-50", type: "reference", kind: "web", authors: [], editors: [], translators: [], title: "Stele of the Vultures",
  container: "Louvre collections", publisher: "Musée du Louvre", volume: null, issue: null, pages: null, year: "2026", doi: null, short: "Louvre, AO 50", url: URL, ...over,
});
const source: Source = { type: "reference", kind: "web", authors: [], editors: [], translators: [], etAl: false, consulted: true, title: "Stele", url: URL, year: 2026 };
const ctx = { evidence: ledger(), sourceExists: (k: string) => k === "taken", today: "2026-10-20" };

// ---------- Sources ----------

test("sources: a new source must be well formed, allowed, unused as a key, and read", () => {
  assert.deepEqual(checkNewSources([proposed()], ctx), []);
  const p = [
    ...checkNewSources([proposed({ key: "Bad Key" })], ctx),
    ...checkNewSources([proposed({ key: "taken" })], ctx),
    ...checkNewSources([proposed({ url: "https://never-read.example" })], ctx),
    ...checkNewSources([proposed({ url: "https://en.wikipedia.org/wiki/Stele" })], ctx),
    ...checkNewSources([proposed({ kind: "article", container: null })], ctx),
  ];
  for (const e of ["lowercase letters", "already in the bibliography", "was not read during this run", "can't be used as evidence", "needs its journal"]) {
    assert.ok(p.some((x) => x.includes(e)), `${e}\n${p.join("\n")}`);
  }
});

test("sources: an excerpt must come from the cited source itself, not another document", () => {
  const bib = { stele: source, other: { ...source, url: "https://other.example" } };
  assert.equal(checkCitedExcerpt("x", "stele", QUOTE, bib, ledger()), null);
  assert.match(checkCitedExcerpt("x", "other", QUOTE, bib, ledger())!, /not found in "other"/);
  assert.match(checkCitedExcerpt("x", "nope", QUOTE, bib, ledger())!, /no source with key/);
  assert.match(checkCitedExcerpt("x", "unread", QUOTE, { unread: { ...source, url: "https://unread.example" } }, ledger())!, /was not read during this run/);
});

test("sources: register_source registers checked entries and refuses bad ones", async () => {
  const registry = new Map<string, Source>();
  const tool = createRegisterSourceTool(ctx, registry);
  const run = { evidence: ctx.evidence, signal: new AbortController().signal };
  assert.match(await tool.run(proposed(), run), /Registered "louvre-ao-50"/);
  assert.equal(registry.get("louvre-ao-50")?.short, "Louvre, AO 50");
  await assert.rejects(tool.run(proposed({ key: "x2", url: "https://never-read.example" }), run), /Not registered/);
});

// ---------- Gatherer: events ----------

type Observed = Parameters<typeof events.check>[0];
const observed = (over: Partial<Observed> = {}): Observed => ({
  existing_id: null, title: "Eannatum of Lagash defeats Umma", kind: "military", place: "Girsu (modern Tello, Iraq)",
  summary: "Eannatum's victory over Umma is recorded on a stele.", aliases: [], year: -2450, earliest: -2450, latest: -2425, approx: true,
  date_marks: "Louvre date for the stele", date_note: null, citations: [{ source_key: "louvre-ao-50", locator: "notice", excerpt: QUOTE }], entities: [],
  ...over,
});
const gctx = (registry = new Map<string, Source>([["louvre-ao-50", source]])) => ({
  from: -2500, to: -2400, evidence: ledger(), exists: (id: string) => id === "known-event", entityExists: () => false, bibliography: {}, registry,
});

test("gatherer: a well-sourced event in the period passes", () => {
  assert.deepEqual(checkGathering(events, { observations: [observed()], omitted: [], coverage_notes: "" }, gctx()), []);
});

test("gatherer: dates, period, citations and ids are checked", () => {
  const sub = (o: Partial<Observed>) => checkGathering(events, { observations: [observed(o)], omitted: [], coverage_notes: "" }, gctx());
  const p = [
    ...sub({ year: -2300, latest: null }),
    ...sub({ earliest: -2400 }),
    ...sub({ year: 0, earliest: null, latest: null }),
    ...sub({ citations: [] }),
    ...sub({ citations: [{ source_key: "louvre-ao-50", locator: null, excerpt: "Eannatum invented war" }] }),
    ...sub({ citations: [{ source_key: "unregistered", locator: null, excerpt: QUOTE }] }),
    ...sub({ existing_id: "ghost" }),
    ...sub({ summary: "Victory [@louvre-ao-50]." }),
  ];
  for (const e of ["outside the requested period", "earliest (-2400) is after year", "no year 0", "at least one citation", "not found in", "register new works", 'no event with id "ghost"', "citations go in citations"]) {
    assert.ok(p.some((x) => x.includes(e)), `${e}\n${p.join("\n")}`);
  }
});

// ---------- Interpreter ----------

const interpretation = (over: Partial<Interpretation["ideas"][number]> = {}, without: Interpretation["events_without_ideas"] = [{ event_id: "puabi-burial", reason: "no idea" }]): Interpretation => ({
  ideas: [{
    existing_id: null, title: "Victory stele", summary: "Monuments recording victories.", category: "politics", origin: "Lagash", year: -2450, year_basis: "Stele date",
    approx: true, aliases: [],
    emergences: [{ event_id: "eannatum-stele", stage: "earliest-evidence", why: "Earliest such monument.", evidence: QUOTE, evidence_url: URL, source_key: null, locator: null, confidence: "medium" }],
    ...over,
  }],
  events_without_ideas: without,
  notes: "",
});
const ictx = { evidence: ledger(), events: new Map([["eannatum-stele", -2450], ["puabi-burial", -2450]]), ideaExists: (id: string) => id === "writing", sourceExists: () => false };

test("interpreter: every event accounted for, with verified evidence", () => {
  assert.deepEqual(checkInterpretation(interpretation(), ictx), []);
  const p = [
    ...checkInterpretation(interpretation({}, []), ictx),
    ...checkInterpretation(interpretation({ year: -2400 }), ictx),
    ...checkInterpretation(interpretation({ existing_id: "nope" }), ictx),
    ...checkInterpretation(interpretation({ emergences: [{ ...interpretation().ideas[0].emergences[0], evidence: "made up" }] }), ictx),
    ...checkInterpretation(interpretation({ emergences: [{ ...interpretation().ideas[0].emergences[0], event_id: "elsewhere" }] }), ictx),
    ...checkInterpretation(interpretation({ emergences: [] }), ictx),
  ];
  for (const e of ['"puabi-burial" is neither', "after this earliest evidence", 'no idea with id "nope"', "excerpt was not found", "not one of this period's events", "needs at least one emergence"]) {
    assert.ok(p.some((x) => x.includes(e)), `${e}\n${p.join("\n")}`);
  }
});

// ---------- Author ----------

const draft: Idea = {
  id: "victory-stele", title: "Victory stele", category: "politics", status: "candidate", date: { year: -2450, approx: true },
  origin: "Lagash", summary: "x", aliases: ["triumphal stele"], sources: [], body: "Proposed.",
};
const authored = (over: Partial<AuthorSubmission> = {}): AuthorSubmission => ({
  decision: "write", reason: "Sourced from the Louvre record.", title: "Victory stele", byline: "Lagash, southern Mesopotamia",
  summary: "Rulers set up stelae recording victories.", year: -2450, earliest: -2450, latest: -2425, approx: true, date_marks: "Louvre date of the Stele of the Vultures",
  date_note: null, body: `The Louvre describes how "${QUOTE}" [@louvre-ao-50, notice].`,
  support: [{ source_key: "louvre-ao-50", locator: "notice", excerpt: QUOTE }], ...over,
});
const actx = () => ({ current: draft, evidence: ledger(), bibliography: {}, registry: new Map<string, Source>([["louvre-ao-50", source]]) });

test("author: a supported entry passes and keeps the id, category and aliases", () => {
  assert.deepEqual(checkAuthorSubmission(authored(), actx()), []);
  const entry = buildEntry(authored(), draft) as Idea;
  assert.deepEqual([entry.id, entry.category, entry.status, entry.aliases, entry.sources], ["victory-stele", "politics", "sourced", ["triumphal stele"], ["louvre-ao-50"]]);
  assert.deepEqual(checkAuthorSubmission(authored({ decision: "decline", reason: "Not an idea." }), actx()), []);
  const quotedLocator = authored({
    body: `A victory is recorded [@louvre-ao-50, paragraph beginning "The stele records"].`,
    support: [{ source_key: "louvre-ao-50", locator: 'paragraph beginning "The stele records"', excerpt: QUOTE }],
  });
  assert.deepEqual(checkAuthorSubmission(quotedLocator, actx()), [], "quotation marks inside a locator aren't a quotation");
});

test("author: unsupported citations, unverified quotations and rule breaks are rejected", () => {
  const p = [
    ...checkAuthorSubmission(authored({ support: [] }), actx()),
    ...checkAuthorSubmission(authored({ body: `As "Eannatum invented the stele entirely by himself" [@louvre-ao-50, notice].` }), actx()),
    ...checkAuthorSubmission(authored({ body: "Uncited claim only." }), actx()),
    ...checkAuthorSubmission(authored({ body: "A claim [@nowhere, p. 1].", support: [{ source_key: "nowhere", locator: "p. 1", excerpt: QUOTE }] }), actx()),
    ...checkAuthorSubmission(authored({ support: [{ source_key: "louvre-ao-50", locator: "notice", excerpt: "words that are not there" }] }), actx()),
    ...checkAuthorSubmission(authored({ decision: "decline", reason: " " }), actx()),
  ];
  for (const e of ["has no support item", "was not found in any document you read", "requires at least one [@citation]", "register new works", "excerpt was not found", "a decline needs a reason"]) {
    assert.ok(p.some((x) => x.includes(e)), `${e}\n${p.join("\n")}`);
  }
});

// ---------- Small helpers ----------

test("ids, years and gathering windows", () => {
  assert.equal(slugify("Eannatum of Lagash's victory over Umma recorded on the Stele of the Vultures at Girsu"), "eannatum-of-lagashs-victory-over-umma-recorded-on-the-stele");
  assert.equal(slugify("Ur-Nanshe of Lagash commemorates temple construction on a perforated relief"), "ur-nanshe-of-lagash-commemorates-temple-construction");
  assert.deepEqual([parseYear("-2500"), parseYear("2500bce"), parseYear("44 BC"), parseYear("1200"), parseYear("x")], [-2500, -2500, -44, 1200, undefined]);
  assert.deepEqual(joinNegativeValues(["events", "--from", "-2500", "--to", "-2400"], ["--from", "--to"]), ["events", "--from=-2500", "--to=-2400"]);
  assert.deepEqual(windows(-2500, -2301), [{ from: -2500, to: -2401 }, { from: -2400, to: -2301 }]);
  assert.deepEqual(windows(-60, 40, 50), [{ from: -60, to: -11 }, { from: -10, to: 40 }], "a window spanning 1 BCE to 1 CE skips year 0");
});
