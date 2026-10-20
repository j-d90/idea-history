// Print the content hash a review of an idea must record. Usage: npm run review-hash -- <id>
import { connect, neo4jConfigFromEnv } from "../kg/src/driver.ts";
import { loadSubject } from "../kg/src/repository.ts";

const id = process.argv[2];
if (!id) {
  console.error("usage: npm run review-hash -- <idea-id>");
  process.exit(1);
}
const driver = await connect(neo4jConfigFromEnv()).catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
const session = driver.session();
try {
  console.log((await session.executeRead((tx) => loadSubject(tx, id))).hash);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await session.close();
  await driver.close();
}
