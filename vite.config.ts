import { defineConfig, loadEnv } from "vite";
import { content } from "./scripts/vite-plugin-content.ts";

export default defineConfig(({ mode }) => {
  // The content plugin connects to Neo4j at build time; give it the .env settings.
  // Variables already set in the environment take precedence.
  process.env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  return { plugins: [content()] };
});
