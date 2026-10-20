import type { ManagedTransaction } from "neo4j-driver";

/** A readable id from a title: "Germ Theory of Disease" → "germ-theory-of-disease". */
export function slugify(text: string, max = 60): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || "untitled";
}

/** A slug not yet used by any node with this label (appends -2, -3, … as needed). */
export async function uniqueId(tx: ManagedTransaction, label: "Idea" | "Entity", text: string, taken: Set<string> = new Set()): Promise<string> {
  const base = slugify(text);
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (taken.has(id)) continue;
    const res = await tx.run(`MATCH (x:${label} {id: $id}) RETURN count(x) AS n`, { id });
    if (res.records[0].get("n") === 0) return id;
  }
}
