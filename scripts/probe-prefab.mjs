#!/usr/bin/env node
// Render envelopes in the real Prefab renderer and print the visible text (+ optional screenshot).
//   node scripts/probe-prefab.mjs envelopes.json [--shot out.png]
import fs from "node:fs";
import { startHarness } from "./lib/prefab-harness.mjs";

const file = process.argv[2];
const list = [].concat(JSON.parse(fs.readFileSync(file, "utf8")));
const h = await startHarness();
let i = 0;
for (const env of list) {
  await h.send(env);
  await h.pg.waitForTimeout(900);
  console.log(`#${i++} ${env.__name ?? ""}:`, (await h.text()).slice(0, 400));
  if (process.argv.includes("--shot")) await h.pg.screenshot({ path: process.argv[process.argv.indexOf("--shot") + 1].replace(".png", `-${i}.png`) });
}
if (h.errors.length) console.log("errors:", h.errors.slice(0, 6));
await h.close();
