// Apply kg/schema.cypher. Usage: npm run kg:migrate
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, neo4jConfigFromEnv } from "./driver.ts";
import { embeddingConfigFromEnv } from "./embeddings.ts";

const { dimensions } = embeddingConfigFromEnv();
const statements = readFileSync(join(import.meta.dirname, "..", "schema.cypher"), "utf8")
  .replaceAll("{{EMBEDDING_DIMENSIONS}}", String(dimensions))
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const driver = await connect(neo4jConfigFromEnv()).catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
try {
  for (const statement of statements) await driver.executeQuery(statement);

  // An existing vector index keeps its original dimensions; catch a mismatch early.
  const { records } = await driver.executeQuery(
    `SHOW VECTOR INDEXES YIELD name, options WHERE name IN ["idea_embedding", "entity_embedding"]
     RETURN name, options.indexConfig["vector.dimensions"] AS dims`,
  );
  for (const r of records) {
    if (Number(r.get("dims")) !== dimensions) {
      console.error(`index ${r.get("name")} has ${r.get("dims")} dimensions but EMBEDDING_DIMENSIONS is ${dimensions}; drop it, re-run migrate, then npm run kg -- embed`);
      process.exitCode = 1;
    }
  }
  console.log(`✓ applied ${statements.length} schema statements (vector dimensions: ${dimensions})`);
} finally {
  await driver.close();
}
