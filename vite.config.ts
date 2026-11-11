import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// index.html carries a short text description of OrganizeIt inside #root so search engines and
// AI assistants (which don't run JavaScript) can read the home page; React replaces it on load.
// The phone app doesn't need it, so the app build drops it.
function dropSeoInApp(mode: string): Plugin {
  return {
    name: "drop-seo-in-app",
    transformIndexHtml: (html) => (mode === "app" ? html.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, "") : html),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), dropSeoInApp(mode)],
  server: { proxy: { "/api": "http://localhost:8787" } },
}));
