import assert from "node:assert/strict";
import { test } from "node:test";
import { EvidenceLedger, normalize } from "../core/evidence.ts";

const doc = (url: string, text: string) => ({ url, finalUrl: url, kind: "pdf", text, bytes: text.length });

test("normalize ignores PDF spacing, hyphenation, quote styles and case", () => {
  assert.equal(normalize("arguably , the world’s first"), normalize("Arguably, the world's first"));
  assert.equal(normalize("hiero-\nglyphic"), normalize("hieroglyphic"));
  assert.equal(normalize("robert k. eng lund"), normalize("Robert K. Englund"));
  assert.equal(normalize("1900–1800"), normalize("1900-1800"));
});

test("locate finds verbatim excerpts, including with ellipses", () => {
  const ledger = new EvidenceLedger();
  ledger.add(doc("https://a.example/one.pdf", "the alphabet was invented among Semitic speakers in the Egyptian realm, inspired iconographically by hieroglyphic writing"));
  ledger.add(doc("https://b.example/two", "Something else entirely."));

  assert.equal(ledger.locate("invented among Semitic speakers in the Egyptian realm")?.url, "https://a.example/one.pdf");
  assert.equal(ledger.locate("the alphabet was invented … inspired iconographically")?.url, "https://a.example/one.pdf");
  assert.equal(ledger.locate("invented among Phoenician sailors"), undefined, "a fabricated quote must not match");
  assert.equal(ledger.locate("inspired iconographically … the alphabet was invented"), undefined, "pieces must appear in order");
  assert.equal(ledger.locate("   "), undefined);
});

test("getOrAdd fetches each URL once, even concurrently", async () => {
  const ledger = new EvidenceLedger();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return doc("https://a.example/x", "text");
  };
  await Promise.all([ledger.getOrAdd("https://a.example/x", fetcher), ledger.getOrAdd("https://a.example/x", fetcher)]);
  await ledger.getOrAdd("https://a.example/x", fetcher);
  assert.equal(calls, 1);
  assert.equal(ledger.all().length, 1);
});
