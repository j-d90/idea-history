import type { Bibliography, Entry, EntryLabel } from "../../src/content/schema.ts";

/** What a review vouches for: the idea or event, the sources it cites, and their content hash. */
export interface ReviewSubject {
  label: EntryLabel;
  entry: Entry;
  sources: Bibliography;
  hash: string;
}

/** "event:<id>" names an event; anything else is an idea id. */
export function parseTarget(arg: string): { label: EntryLabel; id: string } {
  return arg.startsWith("event:") ? { label: "Event", id: arg.slice("event:".length) } : { label: "Idea", id: arg };
}
