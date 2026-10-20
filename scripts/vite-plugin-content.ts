import type { Plugin, ViteDevServer } from "vite";
import type { Driver } from "neo4j-driver";
import { eras } from "../src/data/eras.ts";
import type { EventNotes, EventSummary, RenderedEvent, TimelineIndex } from "../src/content/schema.ts";
import { connect, neo4jConfigFromEnv } from "../kg/src/driver.ts";
import { eventScopes, loadContent } from "../kg/src/repository.ts";
import { renderEvent } from "./render.ts";

// The timeline's content, split so the first load stays small:
//   virtual:events                 the index (counts, kinds, stats) and a loader per era
//   virtual:events/era/<id>        that era's event rows, fetched as you scroll to it
//   virtual:events/notes/<id>      that era's notes and references, fetched when one is opened
// Querying, validation and Markdown rendering run in Node at build time; the
// browser only receives JSON. The whole graph is validated, but only shown
// events (not candidates, and in scope: see eventScopes) reach the page.

const PREFIX = "virtual:events";
const RESOLVED = "\0" + PREFIX;

const eraOf = (year: number) => eras.find((e) => year >= e.start && year < e.end)?.id;

interface Prepared {
  index: TimelineIndex;
  rows: Map<string, EventSummary[]>;
  notes: Map<string, Record<string, EventNotes>>;
}

async function prepare(): Promise<Prepared> {
  const driver: Driver = await connect(neo4jConfigFromEnv());
  try {
    const { events, bibliography } = await loadContent(driver, { validate: true });
    const session = driver.session();
    const scopes = await session.executeRead((tx) => eventScopes(tx)).finally(() => session.close());
    const shown = events.filter((e) => e.status !== "candidate" && (scopes.get(e.id)?.scope ?? "human-past") === "human-past");
    const rows = new Map<string, EventSummary[]>();
    const notes = new Map<string, Record<string, EventNotes>>();
    for (const event of shown) {
      const era = eraOf(event.date.year);
      if (!era) continue;
      const { bodyHtml, references, ...row }: RenderedEvent = renderEvent(event, bibliography);
      rows.set(era, [...(rows.get(era) ?? []), { ...row, hasNotes: !!bodyHtml || references.length > 0 }]);
      notes.set(era, { ...(notes.get(era) ?? {}), [event.id]: { bodyHtml, references } });
    }
    const listed = [...rows.values()].flat();
    return {
      index: {
        total: listed.length,
        checked: listed.filter((e) => e.status === "checked" || e.status === "reviewed").length,
        start: listed.length ? Math.min(...listed.map((e) => e.date.year)) : -3200,
        kinds: [...new Set(listed.map((e) => e.kind))],
        eras: Object.fromEntries([...rows].map(([id, list]) => [id, list.length])),
      },
      rows,
      notes,
    };
  } finally {
    await driver.close();
  }
}

export function content(): Plugin {
  // One graph query serves every module of a build (or of a dev page load).
  let prepared: Promise<Prepared> | undefined;
  const get = () => (prepared ??= prepare());

  return {
    name: "history-of-ideas:content",
    resolveId(id) {
      if (id === PREFIX || id.startsWith(`${PREFIX}/`)) return "\0" + id;
    },
    async load(id) {
      if (!id.startsWith(RESOLVED)) return;
      const p = await get();
      if (id === RESOLVED) {
        const loaders = (kind: string) =>
          `{${Object.keys(p.index.eras).map((era) => `${JSON.stringify(era)}: () => import(${JSON.stringify(`${PREFIX}/${kind}/${era}`)})`).join(", ")}}`;
        return [
          `export const index = ${JSON.stringify(p.index)};`,
          `export const eraLoaders = ${loaders("era")};`,
          `export const notesLoaders = ${loaders("notes")};`,
        ].join("\n");
      }
      const [, kind, era] = id.slice(RESOLVED.length).split("/");
      if (kind === "era") return `export const events = ${JSON.stringify(p.rows.get(era) ?? [])};`;
      if (kind === "notes") return `export const notes = ${JSON.stringify(p.notes.get(era) ?? {})};`;
    },
    configureServer(server: ViteDevServer) {
      // The graph has no file to watch, so re-read it on each page request.
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/" || req.url === "/index.html") {
          prepared = undefined;
          for (const mod of server.moduleGraph.idToModuleMap.values()) {
            if (mod.id?.startsWith(RESOLVED)) server.moduleGraph.invalidateModule(mod);
          }
        }
        next();
      });
    },
  };
}
