// Shared browser harness: the real Prefab renderer in a sandboxed iframe, driven by lib/genui/host.ts.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

export async function startHarness({ width = 760, height = 560 } = {}) {
  const root = path.resolve("public/prefab");
  if (!fs.existsSync(root)) throw new Error("run `npm run prepare:prefab` first");
  const hostJs = (
    await build({ entryPoints: ["lib/genui/host.ts"], bundle: true, write: false, format: "iife", globalName: "HostLib", target: "es2020" })
  ).outputFiles[0].text;
  const page = `<!doctype html><html><body style="margin:0;font-family:sans-serif">
<iframe id="f" src="/prefab/index.html" sandbox="allow-scripts allow-popups" style="width:${width - 40}px;height:300px;border:1px solid #ccc"></iframe>
<script>${hostJs}</script>
<script>
window.log = [];
const f = document.getElementById("f");
const host = new HostLib.PrefabHost((m) => f.contentWindow.postMessage(m, "*"),
  { onUserMessage: (t) => log.push("msg:" + t), onOpenLink: (u) => log.push("link:" + u), onSize: (h) => { log.push("size:" + h); f.style.height = h + "px"; }, onReady: () => log.push("ready") }, "light");
window.host = host;
window.addEventListener("message", (e) => { if (e.source === f.contentWindow) host.handle(e.data); });
</script></body></html>`;
  const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/") return res.writeHead(200, { "content-type": "text/html" }).end(page);
    const file = path.join(root, url.pathname.replace(/^\/prefab\//, ""));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const exe = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const pg = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  pg.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  await pg.goto(`http://127.0.0.1:${server.address().port}`);
  await pg.waitForFunction(() => window.log.includes("ready"), null, { timeout: 20000 });
  const frame = () => pg.frames().find((f) => f.url().includes("/prefab/"));
  return {
    pg,
    errors,
    frame,
    send: (env) => pg.evaluate((e) => window.host.sendEnvelope(e), env),
    log: () => pg.evaluate(() => window.log),
    text: async () => (await frame().locator("body").innerText()).replace(/\s+/g, " ").trim(),
    close: async () => {
      await browser.close();
      server.close();
    },
  };
}
