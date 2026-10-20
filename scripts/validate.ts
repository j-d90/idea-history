import { ContentError, loadIdeas } from "./content.ts";

try {
  const ideas = loadIdeas();
  const counts = Object.groupBy(ideas, (i) => i.status);
  const summary = (["draft", "sourced", "reviewed"] as const)
    .map((s) => `${counts[s]?.length ?? 0} ${s}`)
    .join(", ");
  console.log(`✓ ${ideas.length} ideas valid (${summary})`);
} catch (e) {
  if (!(e instanceof ContentError)) throw e;
  console.error(e.message);
  process.exit(1);
}
