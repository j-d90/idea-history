import type { Plugin } from "vite";
import { contentRoot, loadContent } from "./content.ts";
import { renderIdea } from "./render.ts";

const VIRTUAL_ID = "virtual:ideas";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

/**
 * Exposes validated, pre-rendered content as `virtual:ideas`. Parsing, validation
 * and Markdown rendering run in Node, so the browser bundle only receives JSON.
 * Invalid content fails the build, and in dev shows Vite's error overlay.
 */
export function content(): Plugin {
  return {
    name: "history-of-ideas:content",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      const { ideas, bibliography, warnings } = loadContent();
      for (const w of warnings) this.warn(w);
      return `export const ideas = ${JSON.stringify(ideas.map((i) => renderIdea(i, bibliography)))};`;
    },
    configureServer(server) {
      server.watcher.add(contentRoot);
      const reload = (file: string) => {
        if (!file.startsWith(contentRoot)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("change", reload);
      server.watcher.on("add", reload);
      server.watcher.on("unlink", reload);
    },
  };
}
