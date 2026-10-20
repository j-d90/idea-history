import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { REVIEWER } from "../../../src/content/schema.ts";
import { contentHash, contentRoot, loadContent } from "../../../scripts/content.ts";
import { StaleContentError, type ReviewOutcome, type ReviewStore, type ReviewSubject } from "./types.ts";

const FRONTMATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/;

/** The prototype store: content/ideas/*.md, content/sources.yaml, content/reviews/*.md. */
export class FileReviewStore implements ReviewStore {
  readonly name = "files";
  private root: string;

  constructor(root = contentRoot) {
    this.root = root;
  }

  async load(id: string): Promise<ReviewSubject> {
    // loadContent validates everything; refuse to review content that doesn't validate.
    const { ideas, bibliography } = loadContent(this.root);
    const idea = ideas.find((i) => i.id === id);
    if (!idea) throw new Error(`no such idea: ${id}`);
    const sources = Object.fromEntries(idea.sources.map((k) => [k, bibliography[k]]));
    return { idea, sources, hash: contentHash(idea, bibliography) };
  }

  async save(outcome: ReviewOutcome): Promise<void> {
    const current = await this.load(outcome.ideaId);
    if (current.hash !== outcome.hash) throw new StaleContentError(outcome.ideaId, outcome.hash, current.hash);

    const reviewsDir = join(this.root, "reviews");
    mkdirSync(reviewsDir, { recursive: true });
    writeFileSync(join(reviewsDir, `${outcome.ideaId}.md`), outcome.report);

    // Edit only `status` and `review`, and only when they change: re-serializing
    // the YAML otherwise reformats an author's file for no reason.
    const path = join(this.root, "ideas", `${outcome.ideaId}.md`);
    const match = FRONTMATTER.exec(readFileSync(path, "utf8"))!;
    const doc = parseDocument(match[2]);
    let changed = false;
    if (outcome.verdict === "pass") {
      doc.set("status", "reviewed");
      doc.set("review", { by: REVIEWER, date: outcome.date, hash: outcome.hash });
      changed = true;
    } else if (doc.get("status") === "reviewed") {
      doc.set("status", "sourced");
      doc.delete("review");
      changed = true;
    }
    if (changed) {
      const yaml = doc.toString({ lineWidth: 100 }).trimEnd();
      writeFileSync(path, `${match[1]}${yaml}${match[3]}${match[4]}`);
    }

    // The result must still validate (hash, report and record all agree).
    loadContent(this.root);
  }

  async close(): Promise<void> {}
}
