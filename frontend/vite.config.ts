import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  cacheDir: process.env.OBSERVABILITY_VITE_CACHE_DIR,
  plugins: [react()],
  server: {
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
});