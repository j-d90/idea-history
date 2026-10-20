declare module "virtual:ideas" {
  import type { RenderedEvent, RenderedIdea } from "./content/schema";
  export const ideas: RenderedIdea[];
  export const events: RenderedEvent[];
}
