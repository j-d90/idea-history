import assert from "node:assert/strict";
import { test } from "node:test";
import type { Idea } from "../../src/content/schema.ts";
import { EvidenceLedger } from "../core/evidence.ts";
import { toApiTool } from "../core/tools/types.ts";
import type { ReviewSubject } from "../fact-checker/types.ts";
import { checkSubmission, createSubmitTool, decide, type AcceptedSubmission, type Submission } from "../fact-checker/verdict.ts";

const idea: Idea = {
  id: "alphabet",
  title: "The Alphabet",
  category: "technology",
  status: "sourced",
  date: { year: -1850, approx: true, marks: "Earliest inscriptions" },
  origin: "Egypt and Sinai",
  summary: "Semitic speakers invent the alphabet.",
  aliases: [],
  sources: ["lam-2010"],
  body: "Invented in the Egyptian realm [@lam-2010, p. 190].",
};
const subject: ReviewSubject = {
  label: "Idea",
  entry: idea,
  sources: { "lam-2010": { type: "secondary", kind: "web", title: "Alphabet", url: "https://x.example", year: 2010, authors: [], editors: [], translators: [], etAl: false, consulted: true } },
  hash: "0123456789abcdef",
};
const QUOTE = "the alphabet was invented among Semitic speakers in the Egyptian realm";

function ledger() {
  const l = new EvidenceLedger();
  l.add({ url: "https://x.example", finalUrl: "https://x.example", kind: "html", text: `... ${QUOTE}, inspired by hieroglyphs ...`, bytes: 1 });
  return l;
}

function submission(overrides: Partial<Submission> = {}): Submission {
  const claim = (id: number, location: Submission["claims"][number]["location"], extra = {}) => ({
    id, text: `claim ${id}`, location, source_key: "lam-2010", locator: "p. 190",
    evidence: QUOTE, evidence_url: "https://x.example", verdict: "supported" as const, note: "ok", ...extra,
  });
  return {
    verdict: "pass",
    summary: "All supported.",
    sources: [{ key: "lam-2010", accessed: true, how: "read", bibliographic_details_correct: true, notes: "" }],
    claims: [claim(1, "title"), claim(2, "origin"), claim(3, "summary"), claim(4, "date"), claim(5, "body")],
    checks: { summary_and_title: "ok", date: "ok", attribution_and_framing: "ok", disagreement_searches: [] },
    blocking_issues: [],
    suggestions: [],
    ...overrides,
  };
}

test("a complete, verified submission passes", () => {
  const { problems, verified } = checkSubmission(submission(), subject, ledger());
  assert.deepEqual(problems, []);
  assert.equal(verified.size, 5);
  assert.equal(decide({ submission: submission(), verified, unresolved: [] }).verdict, "pass");
});

test("a fabricated excerpt is rejected", () => {
  const s = submission();
  s.claims[2] = { ...s.claims[2], evidence: "the Phoenicians invented the alphabet in 1050 BCE" };
  const { problems } = checkSubmission(s, subject, ledger());
  assert.ok(problems.some((p) => p.startsWith("claim 3: the excerpt was not found")), problems.join("\n"));
});

test("missing coverage and unknown sources are rejected", () => {
  const s = submission({ sources: [{ key: "other-2020", accessed: true, how: "", bibliographic_details_correct: true, notes: "" }] });
  s.claims = s.claims.filter((c) => c.location !== "date");
  const { problems } = checkSubmission(s, subject, ledger());
  for (const expected of ['no assessment for "lam-2010"', '"other-2020" is not one of', "nothing listed for the date"]) {
    assert.ok(problems.some((p) => p.includes(expected)), `expected: ${expected}\n${problems.join("\n")}`);
  }
});

test("an inconsistent pass is rejected, and decide never upgrades to pass", () => {
  const s = submission();
  s.claims[0] = { ...s.claims[0], verdict: "overstated", evidence: null };
  assert.ok(checkSubmission(s, subject, ledger()).problems.some((p) => p.startsWith('verdict: "pass" with claims not supported')));

  const forced: AcceptedSubmission = { submission: s, verified: new Map(), unresolved: [] };
  assert.equal(decide(forced).verdict, "fail");
});

test("submit_review rejects up to the limit, then accepts with the problems forcing a fail", async () => {
  let accepted: AcceptedSubmission | undefined;
  const tool = createSubmitTool(subject, ledger(), (a) => (accepted = a));
  const bad = submission({ blocking_issues: ["x"] });
  for (let i = 0; i < 3; i++) await assert.rejects(tool.run(bad, { evidence: ledger(), signal: new AbortController().signal }));
  await tool.run(bad, { evidence: ledger(), signal: new AbortController().signal });
  assert.ok(accepted);
  assert.equal(decide(accepted!).verdict, "fail");
});

test("submit_review's schema is valid for strict tool use", () => {
  const def = toApiTool(createSubmitTool(subject, ledger(), () => {}));
  assert.equal(def.strict, true);
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    for (const banned of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems"]) {
      assert.ok(!(banned in n), `${path} uses unsupported constraint ${banned}`);
    }
    if (n.type === "object") {
      assert.equal(n.additionalProperties, false, `${path} must set additionalProperties: false`);
      assert.deepEqual([...(n.required as string[])].sort(), Object.keys(n.properties as object).sort(), `${path} must require every property`);
    }
    for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
  };
  walk(def.input_schema, "input_schema");
});

test("an event review needs claims about its place, not an origin", () => {
  const { origin: _o, category: _c, ...rest } = idea;
  const eventSubject: ReviewSubject = { label: "Event", entry: { ...rest, kind: "cultural", place: "Wadi el-Hol" }, sources: subject.sources, hash: subject.hash };
  const problems = checkSubmission(submission(), eventSubject, ledger()).problems;
  assert.ok(problems.includes("claims: nothing listed for the place"), problems.join("\n"));
  const fixed = submission();
  fixed.claims[1] = { ...fixed.claims[1], location: "place" };
  assert.deepEqual(checkSubmission(fixed, eventSubject, ledger()).problems, []);
});
