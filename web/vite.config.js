import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is served by the CRM server under /next/, so asset URLs are relative to that path.
export default defineConfig({
  base: "/next/",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3100" } },
});
