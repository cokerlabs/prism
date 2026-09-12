import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const HEALTH = JSON.stringify({ ok: true, service: "prism" });

/** Keep local Vite on the same Access path contract as production. */
function prismPathGate(): Plugin {
  return {
    name: "prism-path-gate",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (path === "/in/prism/api/health") {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(HEALTH);
          return;
        }
        if (path === "/" || path === "") {
          res.statusCode = 404;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end("Not found. Prism is at /in/prism/.");
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: "/in/prism/",
  plugins: [react(), prismPathGate()],
  build: {
    outDir: "dist/in/prism",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: "/in/prism/",
  },
  preview: {
    port: 4173,
    open: "/in/prism/",
  },
});
