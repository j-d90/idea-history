import assert from "node:assert/strict";
import { test } from "node:test";
import { frontmatterSchema, sourceSchema, type Bibliography, type Idea } from "../../src/content/schema.ts";
import { contentHash, loadContent } from "../../scripts/content.ts";
import { ideaToProps, propsToFrontmatter, propsToSource, sourceToProps } from "../src/mapping.ts";

// Simulates a write to and read from Neo4j (flat properties, people as separate
// nodes, absent values omitted) and checks every idea in content/ comes back with
// the same content hash. If this holds, a review in either store vouches for the
// same thing.
test("every idea round-trips through the graph mapping with an identical hash", () => {
  const { ideas, bibliography } = loadContent();

  for (const idea of ideas) {
    const graphSources: Bibliography = {};
    for (const key of idea.sources) {
      const { props, people } = sourceToProps(bibliography[key]);
      // Neo4j stores properties as given; the key lives on the node too.
      graphSources[key] = sourceSchema.parse(propsToSource({ ...structuredClone(props), key }, people));
    }

    const props = structuredClone(ideaToProps(idea)) as Record<string, unknown>;
    const links = idea.buildsOn.map((l) => ({ id: l.id, ...(l.why ? { why: l.why } : {}), sources: l.sources }));
    const back: Idea = { id: idea.id, body: (props.body as string) ?? "", ...frontmatterSchema.parse(propsToFrontmatter(props, links, idea.sources)) };

    assert.equal(contentHash(back, graphSources), contentHash(idea, bibliography), idea.id);
    assert.deepEqual(back.review, idea.review, `${idea.id} review`);
    assert.equal(back.status, idea.status, `${idea.id} status`);
  }
});

test("graph properties are flat and null-free", () => {
  const { ideas, bibliography } = loadContent();
  const isScalarOrList = (v: unknown) => ["string", "number", "boolean"].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === "string"));
  for (const idea of ideas) for (const [k, v] of Object.entries(ideaToProps(idea))) assert.ok(isScalarOrList(v), `${idea.id}.${k}`);
  for (const [key, s] of Object.entries(bibliography)) for (const [k, v] of Object.entries(sourceToProps(s).props)) assert.ok(isScalarOrList(v), `${key}.${k}`);
});
