import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const releaseId = (process.env.XLLMAPI_RELEASE_ID ?? "").trim();
const apiBase = (process.env.XLLMAPI_API_BASE ?? "https://api.xllmapi.com").replace(/\/+$/, "");
const docsUrl = (process.env.XLLMAPI_DOCS_URL ?? "http://localhost:3001/docs").replace(/\/+$/, "");

export default defineConfig(({ command }) => ({
  base: command === "build" && releaseId ? `/_releases/${releaseId}/` : "/",
  define: {
    __XLLMAPI_API_BASE__: JSON.stringify(apiBase),
    __XLLMAPI_DOCS_URL__: JSON.stringify(docsUrl),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/v1": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
      "/readyz": "http://localhost:3000",
      "/version": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
}));
