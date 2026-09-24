#!/usr/bin/env node
/**
 * `openjev` — the self-host CLI.
 *
 * Subcommands:
 *   serve           Start the built Node server (Nitro `node-server` output at
 *                   `.output/server/index.mjs`). Honors PORT (default 3000) and
 *                   HOST (default 0.0.0.0).
 *   laya-download   Fetch Laya typed-decision weights from Hugging Face by
 *                   delegating to `scripts/laya-download.sh` (respects
 *                   LAYA_BACKEND / LAYA_MODEL / LAYA_DEST). All extra args and
 *                   env pass straight through.
 *
 * This file is wired as the package `bin`, so `npx openjev <cmd>` and the
 * Docker `CMD ["openjev", "serve"]` both resolve here.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const HELP = `openjev — self-host CLI

Usage:
  openjev serve                 Start the built Node server (.output/server/index.mjs)
  openjev laya-download [args]  Download Laya weights (delegates to scripts/laya-download.sh)
  openjev help                  Show this help
  openjev version               Show the package version

Environment (see .env.example for the complete list):
  PORT                 Node server port (default 3000)
  HOST                 Node server bind host (default 0.0.0.0)
  LAYA_ENGINE_URL      URL of the laya-onnx / laya-mlx sidecar
  OPENJEV_ENGINE_URL  URL of the native C++/Rust decision engine
  DATABASE_URL         Postgres connection string (PGLite fallback if unset)
`;

/** Run a child process, inheriting stdio, and mirror its exit code. */
function run(command, args, opts = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    cwd: ROOT,
    env: process.env,
    ...opts,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  child.on("error", (err) => {
    console.error(`[openjev] failed to launch ${command}: ${err.message}`);
    process.exit(1);
  });
  return child;
}

function serve() {
  const entry = join(ROOT, ".output", "server", "index.mjs");
  if (!existsSync(entry)) {
    console.error(
      "[openjev] No built server found at .output/server/index.mjs.\n" +
        "Build it first with the Node preset:\n" +
        "  NITRO_PRESET=node-server npm run build\n" +
        "(the Docker image does this for you).",
    );
    process.exit(1);
  }
  // Nitro's node-server reads PORT/HOST; default to a stable, container-friendly bind.
  const env = { ...process.env };
  env.PORT = env.PORT ?? "3000";
  env.HOST = env.HOST ?? "0.0.0.0";
  console.log(`[openjev] serving on http://${env.HOST}:${env.PORT}`);
  run(process.execPath, [entry], { env });
}

function layaDownload(rest) {
  const script = join(ROOT, "scripts", "laya-download.sh");
  run("bash", [script, ...rest]);
}

function version() {
  return import("node:fs")
    .then(({ readFileSync }) =>
      JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")),
    )
    .then((pkg) => {
      console.log(pkg.version ?? "0.0.0");
    });
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "serve":
    serve();
    break;
  case "laya-download":
    layaDownload(rest);
    break;
  case "version":
  case "--version":
  case "-v":
    await version();
    break;
  case undefined:
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;
  default:
    console.error(`[openjev] unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
}
