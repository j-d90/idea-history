import type { Bibliography, Idea } from "../../../src/content/schema.ts";

/**
 * Where reviewable content lives. The agent depends only on this interface, so
 * the prototype's Markdown files (FileReviewStore) and the Neo4j knowledge graph
 * (kg/src/graph-store.ts) are interchangeable.
 */
export interface ReviewStore {
  readonly name: string;
  /** Load an idea, the sources it cites, and the content hash a review would vouch for. */
  load(id: string): Promise<ReviewSubject>;
  /** Persist a finished review. Must refuse if the content changed since `load`. */
  save(outcome: ReviewOutcome): Promise<void>;
  close(): Promise<void>;
}

export interface ReviewSubject {
  idea: Idea;
  /** Only the entries the idea cites. */
  sources: Bibliography;
  hash: string;
}

export interface ReviewOutcome {
  ideaId: string;
  verdict: "pass" | "fail";
  /** YYYY-MM-DD */
  date: string;
  /** The hash of the content that was reviewed. */
  hash: string;
  runId: string;
  /** Rendered Markdown report, including its frontmatter. */
  report: string;
}

/** The content changed between loading it for review and saving the result. */
export class StaleContentError extends Error {
  constructor(id: string, reviewed: string, current: string) {
    super(`${id} changed during review (reviewed ${reviewed}, now ${current}); the review was not saved`);
    this.name = "StaleContentError";
  }
}
