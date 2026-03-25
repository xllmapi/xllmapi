import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const releaseId = (process.env.XLLMAPI_RELEASE_ID ?? "").trim();

export default defineConfig(({ command }) => ({
  base: command === "build" && releaseId ? `/_releases/${releaseId}/` : "/",
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
