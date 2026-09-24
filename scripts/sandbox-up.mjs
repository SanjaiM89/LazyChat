#!/usr/bin/env node
/**
 * Idempotent sandbox-service launcher for `npm run dev`.
 *
 * The Next.js app proxies every sandbox/agent action to sandbox/server.mjs
 * on port 8787. If that service isn't running, in-app agents die instantly
 * with "fetch failed" / "Creating Docker sandbox… fetch failed". This script
 * makes `npm run dev` start it automatically (detached, logged to
 * /tmp/omnia-sandbox.log) unless it is already up.
 */
import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SANDBOX_PORT || 8787);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function alreadyUp() {
  return new Promise((resolve) => {
    const sock = net.connect(PORT, HOST);
    sock.on("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });
}

if (await alreadyUp()) {
  console.log(`[sandbox] already running on ${HOST}:${PORT} — skipping.`);
  process.exit(0);
}

const log = fs.openSync("/tmp/omnia-sandbox.log", "a");
const child = spawn(process.execPath, [path.join(ROOT, "sandbox", "server.mjs")], {
  cwd: ROOT, // DATA_DIR defaults to ./data (shared with the app's store)
  detached: true,
  stdio: ["ignore", log, log],
  env: { ...process.env },
});
child.unref();
console.log(`[sandbox] started service (pid ${child.pid}) → log /tmp/omnia-sandbox.log`);
setTimeout(() => process.exit(0), 400);
