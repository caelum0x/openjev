import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

/** The files `src/lib/db.ts` globs — same directory, same non-recursive scope. */
function hasGlobbedMigrations(root: string): boolean {
  try {
    return readdirSync(join(root, "migrations")).some((f) => f.endsWith(".sql"));
  } catch {
    return false;
  }
}

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 *
 * Skipped when there are no migrations to apply (nothing to bootstrap).
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "openjev:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      if (!hasGlobbedMigrations(server.config.root)) return;
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[openjev] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

// `npm run dev` serves the console + API on :8080 (`openjev serve` and the
// Docker image use :3000). `npm run preview` serves a built bundle on :8081.
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    pgliteBootstrapPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            // Default target is Vercel; self-host builds set
            // `NITRO_PRESET=node-server` (see Dockerfile / SELF-HOSTING.md) to
            // emit a standalone Node server at `.output/server/index.mjs`.
            preset:
              process.env.NITRO_PRESET ??
              process.env.SERVER_PRESET ??
              "vercel",
            // PGLite loads its WASM + data files relative to its own module at
            // runtime; bundling it drops those assets, so keep it an external,
            // traced dependency (copied into .output/server/node_modules).
            // onnxruntime-node (embedding engine) is a native addon: same deal.
            traceDeps: ["@electric-sql/pglite", "onnxruntime-node"],
          }),
        ]
      : []),
    viteReact(),
  ],
}));
