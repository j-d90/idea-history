// Validate all content in the knowledge graph. Usage: npm run validate
import { ContentError } from "../src/content/rules.ts";
import { connect, neo4jConfigFromEnv } from "../kg/src/driver.ts";
import { loadContent } from "../kg/src/repository.ts";

const driver = await connect(neo4jConfigFromEnv()).catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
try {
  const { ideas, links, bibliography } = await loadContent(driver, { validate: true });
  const used = new Set(ideas.flatMap((i) => i.sources).concat(links.flatMap((l) => (l.sourceKey ? [l.sourceKey] : []))));
  for (const key of Object.keys(bibliography)) if (!used.has(key)) console.warn(`warning: source "${key}" is not cited by any idea or link`);

  const counts = Object.groupBy(ideas, (i) => i.status);
  const summary = (["candidate", "draft", "sourced", "reviewed"] as const).map((s) => `${counts[s]?.length ?? 0} ${s}`).join(", ");
  const linkSummary = Object.entries(Object.groupBy(links, (l) => `${l.origin}/${l.status}`)).map(([k, v]) => `${v!.length} ${k}`).join(", ");
  console.log(`✓ ${ideas.length} ideas valid (${summary}); ${links.length} links (${linkSummary || "none"})`);
} catch (e) {
  if (!(e instanceof ContentError)) throw e;
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await driver.close();
}
