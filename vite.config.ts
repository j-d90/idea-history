import { defineConfig } from "vite";
import { content } from "./scripts/vite-plugin-content.ts";

export default defineConfig({
  plugins: [content()],
});
