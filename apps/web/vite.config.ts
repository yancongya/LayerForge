import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { layerforgeApi } from "./vite-plugin-layerforge-api";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");

export default defineConfig({
  // Relative base so dist/index.html can be opened without a Vite origin.
  base: "./",
  plugins: [react(), layerforgeApi()],
  server: {
    port: 5173,
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
