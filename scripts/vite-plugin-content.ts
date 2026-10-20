import type { Plugin } from "vite";
import { connect, neo4jConfigFromEnv } from "../kg/src/driver.ts";
import { loadContent } from "../kg/src/repository.ts";
import { renderIdea } from "./render.ts";

const VIRTUAL_ID = "virtual:ideas";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

/**
 * Exposes validated, pre-rendered content from the knowledge graph as
 * `virtual:ideas`. Querying, validation and Markdown rendering run in Node, so
 * the browser bundle only receives JSON. Candidate ideas (uncurated extractor
 * output) are left out. Invalid content fails the build, and in dev shows
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
        const { ideas, bibliography, links } = await loadContent(driver, { validate: true });
        const visible = ideas.filter((i) => i.status !== "candidate");
        const shown = new Set(visible.map((i) => i.id));
        const visibleLinks = links.filter((l) => shown.has(l.from) && shown.has(l.to));
        return `export const ideas = ${JSON.stringify(visible.map((i) => renderIdea(i, bibliography, visibleLinks)))};`;
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
