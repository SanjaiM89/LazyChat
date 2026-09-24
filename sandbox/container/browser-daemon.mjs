#!/usr/bin/env node
import http from "node:http";
import { chromium } from "playwright";

const PORT = Number(process.env.DAEMON_PORT || 18787);
const W = 1280;
const H = 800;

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  locale: "en-US",
});
context.setDefaultTimeout(30_000);
const page = await context.newPage();
try {
  await page.goto("about:blank");
} catch {  }

async function shot() {
  const buf = await page.screenshot({ type: "jpeg", quality: 45 });
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function describe() {
  let title = "";
  try {
    title = await page.title();
  } catch {  }
  return { url: page.url(), title, w: W, h: H, ok: true };
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 2 * 1024 * 1024) resolve({});
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/state") {
      send(res, 200, await describe());
      return;
    }
    if (req.method === "GET" && url.pathname === "/text") {
      const max = Math.min(Number(url.searchParams.get("max")) || 12_000, 30_000);
      const text = await page.evaluate(() => document.body?.innerText || "");
      send(res, 200, { ...(await describe()), text: String(text).slice(0, max) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/screenshot") {
      send(res, 200, { ...(await describe()), image: await shot() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/navigate") {
      const { url: target } = await readJson(req);
      if (!target || !/^https?:\/\//i.test(String(target))) {
        send(res, 400, { error: "navigate needs an http(s) url" });
        return;
      }
      try {
        await page.goto(String(target), { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch {  }
      await page.waitForTimeout(1200);
      send(res, 200, { ...(await describe()), image: await shot() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/click") {
      const body = await readJson(req);
      if (body.selector) {
        await page.waitForSelector(String(body.selector), { timeout: 15_000 });
        await page.click(String(body.selector));
      } else {
        await page.mouse.click(clamp(body.x, 0, W - 1), clamp(body.y, 0, H - 1));
      }
      await page.waitForTimeout(900);
      send(res, 200, { ...(await describe()), image: await shot() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/type") {
      const body = await readJson(req);
      const text = String(body.text ?? "");
      if (body.selector) {
        await page.waitForSelector(String(body.selector), { timeout: 15_000 });
        await page.fill(String(body.selector), "");
        await page.type(String(body.selector), text, { delay: 20 });
      } else {
        await page.keyboard.type(text, { delay: 15 });
      }
      if (body.enter) await page.keyboard.press("Enter");
      await page.waitForTimeout(1100);
      send(res, 200, { ...(await describe()), image: await shot() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/press") {
      const { key } = await readJson(req);
      if (!key) {
        send(res, 400, { error: "press needs a key, e.g. Enter, Escape, Control+l" });
        return;
      }
      await page.keyboard.press(String(key));
      await page.waitForTimeout(800);
      send(res, 200, { ...(await describe()), image: await shot() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/scroll") {
      const body = await readJson(req);
      const px = clamp(body.px ?? 500, -3000, 3000) * (body.direction === "up" ? -1 : 1);
      await page.mouse.wheel(0, px);
      await page.waitForTimeout(600);
      send(res, 200, { ...(await describe()), image: await shot() });
      return;
    }
    if (req.method === "POST" && ["/back", "/forward", "/reload"].includes(url.pathname)) {
      try {
        if (url.pathname === "/back") await page.goBack({ timeout: 15_000 });
        else if (url.pathname === "/forward") await page.goForward({ timeout: 15_000 });
        else await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      } catch {  }
      await page.waitForTimeout(900);
      send(res, 200, { ...(await describe()), image: await shot() });
      return;
    }
    send(res, 404, { error: "unknown endpoint" });
  } catch (e) {
    send(res, 500, { error: String(e?.message || e).slice(0, 400) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[browser-daemon] listening on http://127.0.0.1:${PORT}`);
});
