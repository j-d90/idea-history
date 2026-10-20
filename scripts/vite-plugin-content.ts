import type { Plugin } from "vite";
import { contentDir, loadIdeas } from "./content.ts";

const VIRTUAL_ID = "virtual:ideas";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

/**
 * Exposes validated content as `virtual:ideas`. Parsing and validation run in Node,
 * so the browser bundle only receives JSON. Invalid content fails the build, and in
 * dev shows Vite's error overlay.
 */
export function content(): Plugin {
  return {
    name: "history-of-ideas:content",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      return `export const ideas = ${JSON.stringify(loadIdeas())};`;
    },
    configureServer(server) {
      server.watcher.add(contentDir);
      const reload = (file: string) => {
        if (!file.startsWith(contentDir)) return;
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
