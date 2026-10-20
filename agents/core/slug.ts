import type { ManagedTransaction } from "neo4j-driver";

/** A readable id from a title: "Germ Theory of Disease" → "germ-theory-of-disease". Long titles are cut at a word boundary. */
export function slugify(text: string, max = 60): string {
  const full = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = full.length <= max ? full : full.slice(0, full.lastIndexOf("-", max) > 0 ? full.lastIndexOf("-", max) : max);
  // Don't end a cut-off id on a dangling word ("…-on-a").
  const trimmed = cut.length < full.length ? cut.replace(/(-(a|an|the|of|on|in|at|to|and|by|for|with))+$/, "") : cut;
  return trimmed.replace(/-+$/, "") || "untitled";
}

/** A slug not yet used by any node with this label (appends -2, -3, … as needed). */
export async function uniqueId(tx: ManagedTransaction, label: "Idea" | "Event" | "Entity", text: string, taken: Set<string> = new Set()): Promise<string> {
  const base = slugify(text);
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (taken.has(id)) continue;
    const res = await tx.run(`MATCH (x:${label} {id: $id}) RETURN count(x) AS n`, { id });
    if (res.records[0].get("n") === 0) return id;
  }
}
