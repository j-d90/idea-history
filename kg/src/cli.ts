// Read and write the knowledge graph. Usage: npm run kg -- <command>
//
//   ideas [--status <s>]           list ideas
//   idea get <id>                  print an idea in the editing format (Markdown + YAML)
//   idea put <file.md>...          validate and create/update ideas from files
//   source get <key>               print a source as YAML
//   source put <file.yaml>         validate and create/update sources ({key: entry, ...})
//   links [<id>]                   list links between ideas
//   embed                          embed ideas and entities whose text changed
//   export [<file>]                write a JSON snapshot (default kg/seed/snapshot.json)
//   restore <file> [--force]       load a snapshot into the graph
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { ManagedTransaction } from "neo4j-driver";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify } from "yaml";
import { ContentError, ideaFromMarkdown, ideaToMarkdown } from "../../src/content/rules.ts";
import { bibliographySchema } from "../../src/content/schema.ts";
import { connect, neo4jConfigFromEnv } from "./driver.ts";
import { Embedder, refreshEmbeddings } from "./embeddings.ts";
import { loadContent, loadIdea, loadLinks, loadSources, putIdea, putSource } from "./repository.ts";
import { exportSnapshot, restoreSnapshot } from "./snapshot.ts";

const [cmd, sub, ...rest] = process.argv.slice(2);
const USAGE = readFileSync(import.meta.filename, "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n");

const driver = await connect(neo4jConfigFromEnv()).catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});

async function read<T>(fn: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  const session = driver.session();
  try {
    return await session.executeRead(fn);
  } finally {
    await session.close();
  }
}

async function write<T>(fn: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  const session = driver.session();
  try {
    return await session.executeWrite(fn);
  } finally {
    await session.close();
  }
}

/** Embed whatever changed, if an OpenAI key is configured. */
async function embedChanged(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return console.warn("OPENAI_API_KEY not set; skipping embeddings (run `npm run kg -- embed` later)");
  const { updated } = await refreshEmbeddings(driver, new Embedder());
  if (updated) console.log(`embedded ${updated} changed idea(s)/entit(ies)`);
}

try {
  switch (cmd) {
    case "ideas": {
      const status = sub === "--status" ? rest[0] : undefined;
      const { ideas } = await loadContent(driver);
      for (const i of ideas.filter((x) => !status || x.status === status)) {
        console.log(`${String(i.date.year).padStart(6)}  ${i.status.padEnd(9)}  ${i.id.padEnd(24)} ${i.title}`);
      }
      break;
    }

    case "idea": {
      if (sub === "get" && rest[0]) {
        const idea = await read((tx) => loadIdea(tx, rest[0]));
        if (!idea) throw new Error(`no such idea: ${rest[0]}`);
        process.stdout.write(ideaToMarkdown(idea));
      } else if (sub === "put" && rest.length) {
        for (const file of rest) {
          const idea = ideaFromMarkdown(readFileSync(file, "utf8"));
          const r = await write((tx) => putIdea(tx, idea));
          console.log(`${r.created ? "created" : "updated"} ${idea.id}${r.reviewInvalidated ? " (content changed, so its review no longer applies; status is now sourced)" : ""}`);
        }
        await embedChanged();
      } else throw new Error("usage: idea get <id> | idea put <file.md>...");
      break;
    }

    case "source": {
      if (sub === "get" && rest[0]) {
        const bib = await read((tx) => loadSources(tx, [rest[0]]));
        if (!bib[rest[0]]) throw new Error(`no such source: ${rest[0]}`);
        process.stdout.write(stringify(bib, { lineWidth: 100 }));
      } else if (sub === "put" && rest[0]) {
        const parsed = bibliographySchema.safeParse(parseYaml(readFileSync(rest[0], "utf8")));
        if (!parsed.success) throw new ContentError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
        await write(async (tx) => {
          for (const [key, source] of Object.entries(parsed.data)) await putSource(tx, key, source);
        });
        console.log(`saved ${Object.keys(parsed.data).join(", ")}`);
        // A source change can invalidate reviews of ideas citing it; validation reports which.
        await loadContent(driver, { validate: true }).catch((e) => console.warn(e instanceof ContentError ? e.message : e));
      } else throw new Error("usage: source get <key> | source put <file.yaml>");
      break;
    }

    case "links": {
      const links = await read((tx) => loadLinks(tx, sub));
      for (const l of links) console.log(`${l.from} -${l.type}-> ${l.to}  [${l.origin}, ${l.status}]${l.why ? `  ${l.why}` : ""}`);
      break;
    }

    case "embed": {
      const { updated, total } = await refreshEmbeddings(driver, new Embedder());
      console.log(`✓ embedded ${updated} of ${total} ideas and entities (the rest were current)`);
      break;
    }

    case "export": {
      const file = sub ?? join(import.meta.dirname, "..", "seed", "snapshot.json");
      mkdirSync(dirname(file), { recursive: true });
      const snapshot = await exportSnapshot(driver);
      writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n");
      console.log(`✓ exported ${snapshot.ideas.length} ideas, ${Object.keys(snapshot.sources).length} sources, ${snapshot.links.length} links, ${snapshot.entities.length} entities, ${snapshot.reviews.length} reviews to ${file}`);
      break;
    }

    case "restore": {
      if (!sub) throw new Error("usage: restore <file> [--force]");
      const counts = await restoreSnapshot(driver, JSON.parse(readFileSync(sub, "utf8")), { force: rest.includes("--force") });
      console.log(`✓ restored ${JSON.stringify(counts)}`);
      await embedChanged();
      break;
    }

    default:
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await driver.close();
}
