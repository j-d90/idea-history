// Print a PDF's text page by page, for checking sources.
// Usage: npm run pdftext -- <path-or-url> [firstPage] [lastPage]
import { readFileSync } from "node:fs";
import { extractPdfPages } from "./pdf.ts";

const [input, first = "1", last] = process.argv.slice(2);
if (!input) {
  console.error("usage: npm run pdftext -- <path-or-url> [firstPage] [lastPage]");
  process.exit(1);
}

const data = /^https?:\/\//.test(input)
  ? new Uint8Array(await (await fetch(input)).arrayBuffer())
  : new Uint8Array(readFileSync(input));

const pages = await extractPdfPages(data);
const from = Math.max(1, Number(first));
const to = Math.min(pages.length, Number(last ?? pages.length));
console.log(`[${pages.length} pages; showing ${from}–${to}]`);
for (let n = from; n <= to; n++) console.log(`\n=== pdf page ${n} ===\n${pages[n - 1]}`);
