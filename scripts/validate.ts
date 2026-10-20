// Validate all content in the knowledge graph. Usage: npm run validate
import { ContentError } from "../src/content/rules.ts";
import { connect, neo4jConfigFromEnv } from "../kg/src/driver.ts";
import { loadContent } from "../kg/src/repository.ts";

const driver = await connect(neo4jConfigFromEnv()).catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
try {
  const { ideas, events, links, emergences, bibliography } = await loadContent(driver, { validate: true });
  const used = new Set(
    [...ideas, ...events].flatMap((e) => e.sources).concat([...links, ...emergences].flatMap((l) => (l.sourceKey ? [l.sourceKey] : []))),
  );
  // Sources found for harvesting aren't cited until they're harvested; warn only about the rest.
  const harvest = await driver.executeQuery(`MATCH (s:Source) WHERE s.harvestStatus IS NOT NULL RETURN s.key AS key, s.harvestStatus AS status`);
  const harvestStatus = new Map(harvest.records.map((r) => [r.get("key") as string, r.get("status") as string]));
  const unused = Object.keys(bibliography).filter((k) => !used.has(k) && !harvestStatus.has(k));
  for (const key of unused) console.warn(`warning: source "${key}" is not cited by any entry or link`);
  const count = (s: string) => [...harvestStatus.values()].filter((x) => x === s).length;
  if (harvestStatus.size) console.log(`  sources to harvest: ${count("pending")} pending, ${count("done")} harvested, ${count("failed")} failed`);

  const byStatus = (entries: { status: string }[]) => {
    const counts = Object.groupBy(entries, (e) => e.status);
    return (["candidate", "draft", "sourced", "checked", "reviewed"] as const).map((s) => `${counts[s]?.length ?? 0} ${s}`).join(", ");
  };
  const linkSummary = Object.entries(Object.groupBy(links, (l) => `${l.origin}/${l.status}`)).map(([k, v]) => `${v!.length} ${k}`).join(", ");
  console.log(`✓ valid: ${events.length} events (${byStatus(events)}); ${ideas.length} ideas (${byStatus(ideas)})`);
  console.log(`  ${links.length} links between ideas (${linkSummary || "none"}); ${emergences.length} emergences`);
} catch (e) {
  if (!(e instanceof ContentError)) throw e;
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await driver.close();
}
