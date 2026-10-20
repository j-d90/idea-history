declare module "virtual:events" {
  import type { EventNotes, EventSummary, TimelineIndex } from "./content/schema";
  export const index: TimelineIndex;
  export const eraLoaders: Record<string, () => Promise<{ events: EventSummary[] }>>;
  export const notesLoaders: Record<string, () => Promise<{ notes: Record<string, EventNotes> }>>;
}
