// Apply kg/schema.cypher. Usage: npm run kg:migrate
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, neo4jConfigFromEnv } from "./driver.ts";

const statements = readFileSync(join(import.meta.dirname, "..", "schema.cypher"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const driver = await connect(neo4jConfigFromEnv());
try {
  for (const statement of statements) await driver.executeQuery(statement);
  console.log(`✓ applied ${statements.length} schema statements`);
} finally {
  await driver.close();
}
