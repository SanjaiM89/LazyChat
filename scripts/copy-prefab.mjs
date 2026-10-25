#!/usr/bin/env node
// Copies the official Prefab renderer bundle into public/prefab so chat messages can embed it in a sandboxed iframe.
import fs from "node:fs";
import path from "node:path";

const from = path.resolve("node_modules/@prefecthq/prefab-ui/dist/app");
const to = path.resolve("public/prefab");
if (!fs.existsSync(from)) {
  console.warn("[prefab] @prefecthq/prefab-ui is not installed; skipping (run npm install)");
  process.exit(0);
}
try { fs.rmSync(to, { recursive: true, force: true }); } catch (e) { console.warn("[prefab] could not clear existing dir, reusing it"); }
try { fs.cpSync(from, to, { recursive: true }); } catch (e) { console.warn("[prefab] copy failed, reusing existing"); }
console.log(`[prefab] renderer copied to public/prefab (${fs.readdirSync(to).length} files)`);
