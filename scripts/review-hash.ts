// Print the content hash a review of an idea must record. Usage: npm run review-hash -- <id>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { bibliographySchema, frontmatterSchema } from "../src/content/schema.ts";
import { contentHash, contentRoot } from "./content.ts";

const id = process.argv[2];
if (!id) {
  console.error("usage: npm run review-hash -- <idea-id>");
  process.exit(1);
}
if (!readdirSync(join(contentRoot, "ideas")).includes(`${id}.md`)) {
  console.error(`no such idea: content/ideas/${id}.md`);
  process.exit(1);
}

// Parse just this idea so the hash is available even while other content is invalid.
const raw = readFileSync(join(contentRoot, "ideas", `${id}.md`), "utf8");
const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
if (!match) {
  console.error("missing frontmatter");
  process.exit(1);
}
const fm = frontmatterSchema.parse(parseYaml(match[1]));
const bib = bibliographySchema.parse(parseYaml(readFileSync(join(contentRoot, "sources.yaml"), "utf8")) ?? {});
console.log(contentHash({ id, body: match[2].trim(), ...fm }, bib));
