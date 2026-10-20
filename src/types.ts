export type { EventKind, EventNotes, EventSummary, RenderedEvent, Status, TimelineIndex } from "./content/schema";

export interface Era {
  id: string;
  name: string;
  start: number;
  end: number;
  blurb: string;
}
