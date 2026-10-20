import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Extract a PDF's text, one string per page. */
export async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const { items } = await (await doc.getPage(n)).getTextContent();
      let text = "";
      for (const item of items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
      }
      pages.push(text);
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
