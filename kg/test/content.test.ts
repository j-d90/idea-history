import assert from "node:assert/strict";
import { test } from "node:test";
import { checkContent, contentHash, ideaFromMarkdown, ideaToMarkdown } from "../../src/content/rules.ts";
import type { Bibliography, Idea, IdeaLink, ReviewRecord } from "../../src/content/schema.ts";
import { ideaToProps, propsToIdea, propsToSource, sourceToProps } from "../src/mapping.ts";

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
const check = (ideas: Idea[], links: IdeaLink[] = [], reviews = new Map<string, ReviewRecord>()) => checkContent({ ideas, bibliography: bib, links, latestReviews: reviews });

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
  const pass: ReviewRecord = { runId: "r1", ideaId: "alphabet", verdict: "pass", by: "fact-checker", date: "2026-10-20", hash, report: "" };
  assert.deepEqual(check([reviewed, writing], [], new Map([["alphabet", pass]])), []);
  assert.ok(check([reviewed, writing]).some((x) => x.includes("no passing review record")));
  assert.ok(check([reviewed, writing], [], new Map([["alphabet", { ...pass, verdict: "fail" }]])).some((x) => x.includes("no passing review record")));
  const edited = { ...reviewed, summary: "Changed." };
  assert.ok(check([edited, writing], [], new Map([["alphabet", pass]])).some((x) => x.includes("changed since it was reviewed")));
});

test("aliases and status don't affect the content hash; content does", () => {
  const h = contentHash(idea(), bib);
  assert.equal(contentHash(idea({ aliases: ["other"], status: "draft" }), bib), h);
  assert.notEqual(contentHash(idea({ summary: "Different." }), bib), h);
  assert.notEqual(contentHash(idea(), { "lam-2010": { ...bib["lam-2010"], pages: "pp. 189–196" } }), h);
});

test("the editing format round-trips, and omits the review record", () => {
  const original = idea({ status: "reviewed", review: { by: "fact-checker", date: "2026-10-20", hash: "0123456789abcdef" } });
  const md = ideaToMarkdown(original);
  assert.doesNotMatch(md, /review:/);
  const back = ideaFromMarkdown(md);
  assert.deepEqual({ ...back, review: original.review }, original);
});

test("graph mapping round-trips ideas and sources with identical hashes", () => {
  const original = idea();
  const props = structuredClone(ideaToProps(original)) as Record<string, unknown>;
  const back = propsToIdea(props, original.sources);
  const { props: sprops, people } = sourceToProps(bib["lam-2010"]);
  const source = propsToSource({ ...structuredClone(sprops), key: "lam-2010" }, people);
  assert.deepEqual(back, original);
  assert.equal(contentHash(back, { "lam-2010": source }), contentHash(original, bib));
});
