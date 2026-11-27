import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The shell is a single-page app (07 §10). In development Vite serves it and
// forwards /api to the Fastify server (pnpm dev starts both).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: `http://127.0.0.1:${process.env.PORT ?? 8787}`, changeOrigin: false } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
