#!/usr/bin/env node
// Browser check of the whole GenUI path in a real browser: streams the prompt's example UI prefix by prefix
// (partial-JSON parse -> repair -> host -> official renderer), then verifies the final UI, state-driven interactivity,
// the SendMessage bridge, dark mode and that the iframe is sandboxed away from the page.
//
//   npx tsx scripts/e2e-prefab.mjs [--shot out.png]
import { parsePartialJson } from "ai";
import { repairPartialEnvelope, validateEnvelope } from "../lib/genui/envelope";
import { GENUI_EXAMPLE } from "../lib/genui/prompt";
import { startHarness } from "./lib/prefab-harness.mjs";

const h = await startHarness();
const wrap = (e) => ({ ...e, view: { type: "Div", cssClass: "p-4", children: [e.view] } }); // same chrome as PrefabView
const send = (e) => h.send(wrap(e));
const fail = async (msg) => {
  console.error("FAIL:", msg, "\nlog:", await h.log(), "\nerrors:", h.errors.slice(0, 5));
  await h.pg.screenshot({ path: "e2e-prefab-fail.png" });
  await h.close();
  process.exit(1);
};
const ok = (m) => console.log("ok:", m);

// 1. Stream the example in ~40-char steps, sending only envelopes that changed (what the chat does).
const text = JSON.stringify(GENUI_EXAMPLE);
let sent = 0;
let last = "";
const texts = [];
for (let n = 40; n <= text.length + 40; n += 40) {
  const { value } = await parsePartialJson(text.slice(0, Math.min(n, text.length)));
  const env = repairPartialEnvelope(value);
  if (!env) continue;
  const s = JSON.stringify(env);
  if (s === last) continue;
  last = s;
  await send(env);
  sent++;
  await h.pg.waitForTimeout(60);
  texts.push((await h.text()).length);
}
if (sent < 8) await fail(`only ${sent} distinct partial renders`);
ok(`streamed ${sent} progressive renders`);
if (texts.at(-1) <= texts[0]) await fail("content did not grow while streaming");
await send(validateEnvelope(GENUI_EXAMPLE).envelope);
await h.pg.waitForTimeout(800);

const frame = h.frame;
const body = await h.text();
for (const needle of ["Sales overview", "Revenue", "$1.2M", "Orders", "Trend", "Details", "Dig deeper"]) {
  if (!body.includes(needle)) await fail(`final UI is missing "${needle}": ${body.slice(0, 300)}`);
}
ok("final UI complete");

// 2. State-driven table: the second tab renders rows from state via {{ rows }} and search filters them.
await frame().getByRole("tab", { name: "Details" }).click();
await frame().getByText("APAC").first().waitFor({ timeout: 8000 }).catch(() => fail("DataTable rows from state not shown"));
ok("tabs + DataTable({{ rows }})");

// 3. Interactivity without a model turn: input bound to state is echoed.
await send({
  version: "0.3",
  state: { who: "world" },
  view: { type: "Column", children: [{ type: "Input", name: "who" }, { type: "Text", content: "Hello {{ who }}!" }] },
});
await frame().getByText("Hello world!").waitFor({ timeout: 8000 }).catch(() => fail("state interpolation failed"));
await frame().locator("input").first().fill("Prefab");
await frame().getByText("Hello Prefab!").waitFor({ timeout: 8000 }).catch(() => fail("input -> state binding failed"));
ok("input bound to state updates live");

// 4. SendMessage bridge.
await send(validateEnvelope(GENUI_EXAMPLE).envelope);
await frame().getByRole("button", { name: "Dig deeper" }).click();
await h.pg.waitForFunction(() => window.log.some((l) => l.startsWith("msg:")), null, { timeout: 5000 }).catch(() => fail("sendMessage never reached the host"));
const msg = (await h.log()).find((l) => l.startsWith("msg:"));
if (!msg.includes("regional differences")) await fail("wrong message " + msg);
ok("SendMessage -> chat: " + msg.slice(4, 50) + "...");

// 5. Sandbox: the renderer cannot reach the embedding page.
const reach = await frame().evaluate(() => {
  try {
    return String(window.parent.document.title);
  } catch (e) {
    return "blocked";
  }
});
if (reach !== "blocked") await fail("iframe could read the parent document");
ok("iframe is isolated from the page");

// 6. Dark mode.
await h.pg.evaluate(() => window.host.setTheme("dark"));
await h.pg.waitForTimeout(300);
const shot = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : null;
if (shot) await h.pg.screenshot({ path: shot });
const real = h.errors.filter((e) => !/404/.test(e));
if (real.length) console.warn("page errors:", real.slice(0, 5));
await h.close();
console.log("PASS");
