import type { ManagedTransaction } from "neo4j-driver";
import { z } from "zod/v4";
import { entityKinds, type EntryLabel } from "../../src/content/schema.ts";
import { linkEntity, upsertEntity } from "../../kg/src/repository.ts";
import { uniqueId } from "./slug.ts";

/** An entity an agent attaches to an idea or event. Strict tool schema: nullable instead of optional. */
export const EntityRef = z.strictObject({
  existing_id: z.string().nullable().describe("Id of the matching entity from find_similar_entities, or null if new"),
  name: z.string(),
  kind: z.enum(entityKinds),
  role: z.string().describe("How it relates to the idea or event, e.g. originator, ruler, place, key text, opponent"),
  description: z.string().describe("One short neutral sentence"),
  aliases: z.array(z.string()),
});

export type EntityRef = z.infer<typeof EntityRef>;

export function checkEntityRefs(at: string, refs: EntityRef[], entityExists: (id: string) => boolean): string[] {
  return refs.flatMap((e) => (e.existing_id && !entityExists(e.existing_id) ? [`${at}: no entity with id "${e.existing_id}"`] : []));
}

/**
 * Create or reuse entities and attach them to an entry. `seen` maps name|kind to
 * id across one run, so an entity mentioned several times is created once.
 * Returns how many entities were created.
 */
export async function writeEntities(
  tx: ManagedTransaction,
  label: EntryLabel,
  id: string,
  refs: EntityRef[],
  runId: string,
  seen: Map<string, string>,
): Promise<number> {
  let created = 0;
  for (const e of refs) {
    const ref = `${e.name.trim().toLowerCase()}|${e.kind}`;
    let entityId = e.existing_id ?? seen.get(ref);
    if (!entityId) {
      entityId = await uniqueId(tx, "Entity", e.name);
      created++;
    }
    seen.set(ref, entityId);
    await upsertEntity(tx, { id: entityId, name: e.name.trim(), kind: e.kind, description: e.description, aliases: e.aliases }, runId);
    await linkEntity(tx, label, id, entityId, e.role, runId);
  }
  return created;
}
