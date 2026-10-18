// Drives the running dev server's /dev/genui harness (real GenUiCard + PrefabView + Next headers): the renderer must
// load, receive the streamed UI, and route its SendMessage button back to the chat bus.
//   npm run dev   (in another terminal)   then   node scripts/e2e-genui-app.mjs [baseUrl]
import { chromium } from "playwright-core";
const exe = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const b = await chromium.launch({ executablePath: exe, headless: true });
const pg = await b.newPage({ viewport: { width: 900, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await pg.goto((process.argv[2] ?? "http://localhost:3000") + "/dev/genui", { waitUntil: "load", timeout: 120000 });
const frame = () => pg.frames().find((f) => f.url().includes("/prefab/"));
await pg.waitForFunction(() => document.querySelector("iframe"), null, { timeout: 60000 });
await pg.waitForTimeout(8000);
const f = frame();
console.log("frame:", f ? f.url() : "none");
const text = f ? (await f.locator("body").innerText()).replace(/\s+/g, " ") : "";
console.log("text:", text.slice(0, 200));
await f.getByRole("button", { name: "Dig deeper" }).click({ timeout: 3000 }).catch(() => console.log("no button"));
await pg.waitForTimeout(500);
console.log("messages:", await pg.getByTestId("messages").innerText());
console.log("errors:", errs.slice(0, 5));
if (!text.includes("Sales overview") || !(await pg.getByTestId("messages").innerText()).includes("Analyse")) process.exitCode = 1;
await b.close();
