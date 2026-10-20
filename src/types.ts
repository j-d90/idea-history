export type { Category, Idea, IdeaDate, IdeaLink, LinkType, RenderedIdea, Review, Source, Status } from "./content/schema";

export interface Era {
  id: string;
  name: string;
  start: number;
  end: number;
  blurb: string;
}
