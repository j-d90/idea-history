export type {
  Category,
  EmergenceStage,
  EventKind,
  Idea,
  IdeaDate,
  IdeaLink,
  LinkType,
  RenderedEvent,
  RenderedIdea,
  Review,
  Source,
  Status,
} from "./content/schema";

export interface Era {
  id: string;
  name: string;
  start: number;
  end: number;
  blurb: string;
}
