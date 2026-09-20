import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Self-contained bundle into ./renderer/ with relative asset paths
// (served from mosaic-addon://fleet-manager/, not domain root).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "./renderer",
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
