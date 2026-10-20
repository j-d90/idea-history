import type { Plugin } from "vite";
import { connect, neo4jConfigFromEnv } from "../kg/src/driver.ts";
import { loadContent } from "../kg/src/repository.ts";
import { renderEvent, renderIdea } from "./render.ts";

const VIRTUAL_ID = "virtual:ideas";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

/**
 * Exposes validated, pre-rendered content from the knowledge graph as
 * `virtual:ideas` (ideas and events). Querying, validation and Markdown
 * rendering run in Node, so the browser bundle only receives JSON. Candidates
 * (uncurated agent proposals) are left out. Invalid content fails the build, and in dev shows
 * Vite's error overlay. In dev, each page load re-reads the graph.
 */
export function content(): Plugin {
  return {
    name: "history-of-ideas:content",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return;
      const driver = await connect(neo4jConfigFromEnv());
      try {
        const { ideas, events, bibliography, links, emergences } = await loadContent(driver, { validate: true });
        const visibleIdeas = ideas.filter((i) => i.status !== "candidate");
        const visibleEvents = events.filter((e) => e.status !== "candidate");
        const shown = new Set(visibleIdeas.map((i) => i.id));
        const shownEvents = new Set(visibleEvents.map((e) => e.id));
        const visibleLinks = links.filter((l) => shown.has(l.from) && shown.has(l.to));
        const visibleEmergences = emergences.filter((e) => shown.has(e.idea) && shownEvents.has(e.event));
        return [
          `export const ideas = ${JSON.stringify(visibleIdeas.map((i) => renderIdea(i, bibliography, visibleLinks, visibleEmergences)))};`,
          `export const events = ${JSON.stringify(visibleEvents.map((e) => renderEvent(e, bibliography, visibleEmergences)))};`,
        ].join("\n");
      } finally {
        await driver.close();
      }
    },
    configureServer(server) {
      // The graph has no file to watch, so refresh content on each page request.
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/" || req.url === "/index.html") {
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        next();
      });
    },
  };
}
