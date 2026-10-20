import type { Bibliography, Idea } from "../../src/content/schema.ts";

/** What a review vouches for: the idea, the sources it cites, and their content hash. */
export interface ReviewSubject {
  idea: Idea;
  sources: Bibliography;
  hash: string;
}
