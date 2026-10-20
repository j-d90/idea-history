import assert from "node:assert/strict";
import { test } from "node:test";
import { EvidenceLedger } from "../core/evidence.ts";
import { toApiTool } from "../core/tools/types.ts";
import { checkExtraction, createSubmitExtractionTool, type Extraction } from "../extractor/schema.ts";
import { checkLinks, createSubmitLinksTool, type LinkSubmission } from "../linker/schema.ts";

const QUOTE = "the alphabet was invented among Semitic speakers in the Egyptian realm";
function ledger() {
  const l = new EvidenceLedger();
  l.add({ url: "https://x.example/doc", finalUrl: "https://x.example/doc", kind: "pdf", text: `... ${QUOTE}, inspired by hieroglyphs ...`, bytes: 1 });
  return l;
}

/** Strict tool use: every object closed and fully required, no numeric/length constraints. */
function assertStrictSchema(schema: unknown) {
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    for (const banned of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "multipleOf"]) assert.ok(!(banned in n), `${path}: ${banned}`);
    if (n.type === "object") {
      assert.equal(n.additionalProperties, false, path);
      assert.deepEqual([...(n.required as string[])].sort(), Object.keys(n.properties as object).sort(), path);
    }
    for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
  };
  walk(schema, "input_schema");
}

// ---------- Extractor ----------

const extraction = (over: Partial<Extraction["ideas"][number]> = {}): Extraction => ({
  ideas: [
    {
      existing_id: null, title: "Acrophony", summary: "Letters named for objects whose names begin with the sound.", aliases: ["acrophonic principle"],
      category: "technology", year: -1850, year_basis: "earliest alphabetic inscriptions", approx: true, origin: "Semitic speakers in Egypt",
      evidence: QUOTE, evidence_url: "https://x.example/doc", locator: "p. 190",
      entities: [{ existing_id: null, name: "Wadi el-Hol", kind: "place", role: "find site", description: "Desert site near Thebes.", aliases: [] }],
      ...over,
    },
  ],
  notes: "",
});
const xctx = (ideas: string[] = ["alphabet"], entities: string[] = []) => ({
  evidence: ledger(),
  ideaExists: (id: string) => ideas.includes(id),
  entityExists: (id: string) => entities.includes(id),
});

test("extractor: a valid extraction passes", () => {
  assert.deepEqual(checkExtraction(extraction(), xctx()), []);
  assert.deepEqual(checkExtraction(extraction({ existing_id: "alphabet", year: null, year_basis: null, origin: null }), xctx()), [], "matched ideas don't need a year");
});

test("extractor: fabricated evidence, unknown ids and incomplete new ideas are rejected", () => {
  const p = [
    ...checkExtraction(extraction({ evidence: "the Phoenicians invented writing" }), xctx()),
    ...checkExtraction(extraction({ existing_id: "no-such-idea" }), xctx()),
    ...checkExtraction(extraction({ year: null, year_basis: null, origin: null }), xctx()),
    ...checkExtraction(extraction({ summary: "x".repeat(321) }), xctx()),
    ...checkExtraction(extraction({ entities: [{ existing_id: "ghost", name: "G", kind: "person", role: "r", description: "", aliases: [] }] }), xctx()),
  ];
  for (const e of ["excerpt was not found", 'no idea with id "no-such-idea"', "needs an integer year", "needs year_basis", "needs an origin", "limit is 320", 'no entity with id "ghost"']) {
    assert.ok(p.some((x) => x.includes(e)), `${e}\n${p.join("\n")}`);
  }
});

test("extractor: gives up after repeated rejections", async () => {
  let gaveUp = false;
  const tool = createSubmitExtractionTool(xctx(), () => assert.fail("must not accept"), () => (gaveUp = true));
  const bad = extraction({ evidence: "made up" });
  for (let i = 0; i < 4; i++) await assert.rejects(tool.run(bad, { evidence: ledger(), signal: new AbortController().signal }));
  assert.ok(gaveUp);
  assertStrictSchema(toApiTool(tool).input_schema);
});

// ---------- Linker ----------

const ideas = new Map([
  ["alphabet", { year: -1850, status: "sourced" }],
  ["writing", { year: -3200, status: "sourced" }],
  ["printing", { year: 1440, status: "draft" }],
  ["cand", { year: -3000, status: "candidate" }],
]);
const lctx = (mustConsider = ["writing"]) => ({
  ideaId: "alphabet", ideaYear: -1850, evidence: ledger(), mustConsider,
  lookup: (id: string) => ideas.get(id), sourceExists: (k: string) => k === "lam-2010",
});
const link = (over: Partial<LinkSubmission["links"][number]> = {}) => ({
  target_id: "writing", type: "BUILDS_ON" as const, why: "Signs adapted from hieroglyphs.", evidence: QUOTE,
  evidence_url: "https://x.example/doc", source_key: "lam-2010", locator: "p. 190", confidence: "high" as const, ...over,
});

test("linker: a valid submission passes", () => {
  assert.deepEqual(checkLinks({ links: [link()], considered: [] }, lctx()), []);
  assert.deepEqual(checkLinks({ links: [], considered: [{ target_id: "writing", reason: "no evidence" }] }, lctx()), []);
});

test("linker: later, candidate, unknown, unsupported and unaccounted targets are rejected", () => {
  const p = [
    ...checkLinks({ links: [link({ target_id: "printing" })], considered: [{ target_id: "writing", reason: "" }] }, lctx()),
    ...checkLinks({ links: [link({ target_id: "cand" })], considered: [{ target_id: "writing", reason: "" }] }, lctx()),
    ...checkLinks({ links: [link({ evidence: "writing begat the alphabet" })], considered: [] }, lctx()),
    ...checkLinks({ links: [link({ source_key: "nope" })], considered: [] }, lctx()),
    ...checkLinks({ links: [], considered: [] }, lctx()),
    ...checkLinks({ links: [link(), link({ type: "PARALLELS" })], considered: [] }, lctx()),
  ];
  for (const e of ["the target is later", "candidate ideas can't be linked", "excerpt was not found", 'no source with key "nope"', "neither linked nor in considered", "listed twice"]) {
    assert.ok(p.some((x) => x.includes(e)), `${e}\n${p.join("\n")}`);
  }
});

test("linker: submit tool accepts a valid submission once, and its schema is strict-valid", async () => {
  let accepted: LinkSubmission | undefined;
  const tool = createSubmitLinksTool(lctx(), (s) => (accepted = s), () => assert.fail("must not give up"));
  await tool.run({ links: [link()], considered: [] }, { evidence: ledger(), signal: new AbortController().signal });
  assert.equal(accepted?.links.length, 1);
  await assert.rejects(tool.run({ links: [link()], considered: [] }, { evidence: ledger(), signal: new AbortController().signal }));
  assertStrictSchema(toApiTool(tool).input_schema);
});

// ---------- Source policy ----------

import { disallowedEvidence } from "../core/policy.ts";

test("policy: Wikipedia (including archived copies and mirrors) and study sites are disallowed; scholarship isn't", () => {
  for (const url of [
    "https://en.wikipedia.org/wiki/Printing_press",
    "https://de.m.wikipedia.org/wiki/Buchdruck",
    "http://web.archive.org/web/2024/https://en.wikipedia.org/wiki/Paper",
    "https://www.wikiwand.com/en/Printing_press",
    "https://www.savemyexams.co.uk/gcse/history",
    "https://www.coursehero.com/file/123",
  ]) assert.ok(disallowedEvidence(url), url);
  for (const url of ["https://www.penn.museum/sites/expedition/the-alphabet/", "https://doi.org/10.3390/biom12040596", "https://arxiv.org/abs/1706.03762", "http://web.archive.org/web/2007/http://www.ucl.ac.uk/x"]) {
    assert.equal(disallowedEvidence(url), null, url);
  }
});

test("linker: a verbatim excerpt from Wikipedia is still rejected", () => {
  const l = new EvidenceLedger();
  l.add({ url: "https://en.wikipedia.org/wiki/X", finalUrl: "https://en.wikipedia.org/wiki/X", kind: "html", text: QUOTE, bytes: 1 });
  const p = checkLinks({ links: [link({ evidence_url: "https://en.wikipedia.org/wiki/X" })], considered: [] }, { ...lctx(), evidence: l });
  assert.ok(p.some((x) => x.includes("can't be used as evidence")), p.join("\n"));
});
