export type { Category, Idea, IdeaDate, Link, RenderedIdea, Review, Source, Status } from "./content/schema";

export interface Era {
  id: string;
  name: string;
  start: number;
  end: number;
  blurb: string;
}
