import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is served by the CRM server under /next/, so asset URLs are relative to that path.
export default defineConfig({
  base: "/next/",
  plugins: [react()],
  // fonts stay as files: the server's Content-Security-Policy refuses data: fonts
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined) },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3100" } },
});
