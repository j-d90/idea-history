// Print the content hash a review of an idea or event must record.
// Usage: npm run review-hash -- <idea-id> | event:<event-id>
import { connect, neo4jConfigFromEnv } from "../kg/src/driver.ts";
import { loadSubject } from "../kg/src/repository.ts";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: npm run review-hash -- <idea-id> | event:<event-id>");
  process.exit(1);
}
const driver = await connect(neo4jConfigFromEnv()).catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
const session = driver.session();
try {
  const [label, id] = arg.startsWith("event:") ? (["Event", arg.slice(6)] as const) : (["Idea", arg] as const);
  console.log((await session.executeRead((tx) => loadSubject(tx, label, id))).hash);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await session.close();
  await driver.close();
}
