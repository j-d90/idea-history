export type { EventKind, RenderedEvent, Status } from "./content/schema";

export interface Era {
  id: string;
  name: string;
  start: number;
  end: number;
  blurb: string;
}
