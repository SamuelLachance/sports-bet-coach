import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  plugins: [react()],
  define: {
    "process.cwd": "(() => \"/\")",
  },
  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "../server"),
      "node:fs/promises": path.resolve(__dirname, "src/sync/stubs/fs.ts"),
      "node:fs": path.resolve(__dirname, "src/sync/stubs/fs.ts"),
      "node:path": path.resolve(__dirname, "src/sync/stubs/path.ts"),
      "node-cache": path.resolve(__dirname, "src/sync/stubs/node-cache.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
