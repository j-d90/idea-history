export type { Category, Idea, IdeaDate, Link, Source, Status } from "./content/schema";

export interface Era {
  id: string;
  name: string;
  start: number;
  end: number;
  blurb: string;
}
