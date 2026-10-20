// Print a PDF's text page by page, for checking sources.
// Usage: npm run pdftext -- <path-or-url> [firstPage] [lastPage]
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [input, first = "1", last] = process.argv.slice(2);
if (!input) {
  console.error("usage: npm run pdftext -- <path-or-url> [firstPage] [lastPage]");
  process.exit(1);
}

const data = /^https?:\/\//.test(input)
  ? new Uint8Array(await (await fetch(input)).arrayBuffer())
  : new Uint8Array(readFileSync(input));

const doc = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
const from = Math.max(1, Number(first));
const to = Math.min(doc.numPages, Number(last ?? doc.numPages));
console.log(`[${doc.numPages} pages; showing ${from}–${to}]`);

for (let n = from; n <= to; n++) {
  const page = await doc.getPage(n);
  const { items } = await page.getTextContent();
  let text = "";
  for (const item of items) {
    if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
  }
  console.log(`\n=== pdf page ${n} ===\n${text}`);
}
