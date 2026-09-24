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
const START_PAGES = [
  "https://www.google.com/?hl=en",
  "https://html.duckduckgo.com/html/?q=welcome",
  "about:blank",
];
for (const start of START_PAGES) {
  try {
    await page.goto(start, { waitUntil: "domcontentloaded", timeout: 30_000 });
    break;
  } catch {  }
}

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

function cleanUrl(href, base) {
  try {
    let raw = String(href || "");
    if (raw.startsWith("//")) raw = "https:" + raw;
    const u = new URL(raw, base);
    if (u.hostname.includes("google.")) {
      const target = u.searchParams.get("q") || u.searchParams.get("url");
      if (target && /^https?:\/\//i.test(target)) return target;
      return "";
    }
    if (u.hostname.includes("bing.com") && u.pathname.includes("/ck/")) {
      return decodeBingUrl(u);
    }
    if ((u.hostname.includes("duckduckgo.com") && u.pathname === "/l/") || u.hostname === "duckduckgo.com") {
      const target = u.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
    if (!/^https?:\/\//i.test(u.href)) return "";
    return u.href;
  } catch {
    return "";
  }
}

function decodeBingUrl(u) {
  try {
    const enc = (u.searchParams.get("u") || "").replace(/^a1/, "");
    if (!enc) return "";
    const b64 = enc.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const out = Buffer.from(padded, "base64").toString("utf8");
    return /^https?:\/\//i.test(out) ? out : "";
  } catch {
    return "";
  }
}

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function finalize(raw, base, max) {
  const out = [];
  const seen = new Set();
  for (const r of raw) {
    const url = cleanUrl(r.url, base);
    if (!url || seen.has(url)) continue;
    const host = hostOf(url);
    if (!host || host.includes("google.") || host.includes("bing.com") || host.includes("duckduckgo.") || host.includes("brave.com")) continue;
    seen.add(url);
    out.push({ title: String(r.title || "").slice(0, 160), url, hostname: host, position: out.length + 1 });
    if (out.length >= max) break;
  }
  return out;
}

async function extractGoogleResults(max) {
  return page.evaluate((limit) => {
    const out = [];
    const seen = new Set();
    const push = (a) => {
      const text = (a.innerText || "").trim();
      const href = a.getAttribute("href") || "";
      if (!text || text.length < 8 || text.length > 220) return;
      if (!href || seen.has(href)) return;
      seen.add(href);
      out.push({ title: text.slice(0, 160), url: href });
    };
    document.querySelectorAll("div#search a h3").forEach((h) => {
      const a = h.closest("a");
      if (a) push(a);
    });
    if (out.length < limit) {
      document.querySelectorAll("a h3").forEach((h) => {
        const a = h.closest("a");
        if (a) push(a);
      });
    }
    return out.slice(0, limit);
  }, max);
}

async function typeInto(boxSel, query) {
  const box = page.locator(boxSel).first();
  await box.waitFor({ timeout: 12_000 });
  await box.click();
  await box.fill("");
  await box.pressSequentially(query, { delay: 25 });
  await page.waitForTimeout(400);
  await box.press("Enter");
  await page.waitForTimeout(2200);
}

async function tryGoogle(query, max) {
  await page.goto("https://www.google.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(900);
  await typeInto('textarea[name="q"], input[name="q"]', query);
  if (page.url().includes("/sorry/") || page.url().includes("captcha")) return null;
  const raw = await extractGoogleResults(max);
  const results = finalize(raw, page.url(), max);
  return results.length ? { engine: "google", results } : null;
}

async function tryBing(query, max) {
  await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(2200);
  const raw = await page.evaluate((limit) => {
    const out = [];
    document.querySelectorAll("li.b_algo h2 a, #b_results h2 a").forEach((a) => {
      const title = (a.innerText || "").trim();
      const href = a.getAttribute("href") || "";
      if (title && href) out.push({ title: title.slice(0, 160), url: href });
    });
    return out.slice(0, limit);
  }, max);
  const results = finalize(raw, page.url(), max);
  return results.length ? { engine: "bing", results } : null;
}

async function tryBrave(query, max) {
  await page.goto(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(2500);
  const raw = await page.evaluate((limit) => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll("div.snippet a[href^='http'], a.l1[href^='http']").forEach((a) => {
      const text = (a.innerText || "").trim();
      const href = a.getAttribute("href") || "";
      if (!text || text.length < 12 || text.length > 240 || seen.has(href)) return;
      seen.add(href);
      out.push({ title: text.slice(0, 160), url: href });
    });
    return out.slice(0, limit);
  }, max);
  const results = finalize(raw, page.url(), max);
  return results.length ? { engine: "brave", results } : null;
}

async function fetchDdg(query, max) {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const raw = [];
    const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && raw.length < max) {
      const title = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").trim();
      if (title) raw.push({ title, url: m[1] });
    }
    const results = finalize(raw, "https://html.duckduckgo.com/", max);
    return results.length ? { engine: "duckduckgo", results } : null;
  } catch {
    return null;
  }
}

async function humanSearch(query, max) {
  for (const attempt of [tryGoogle, tryBing, tryBrave, fetchDdg]) {
    try {
      const hit = await attempt(query, max);
      if (hit) return { ...hit, query, image: await shot() };
    } catch {  }
  }
  return { engine: "none", query, results: [], image: await shot().catch(() => undefined) };
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
    if (req.method === "POST" && url.pathname === "/search") {
      const body = await readJson(req);
      const query = String(body.query || "").trim();
      if (!query) {
        send(res, 400, { error: "search needs a query" });
        return;
      }
      const max = Math.max(1, Math.min(Number(body.max) || 8, 15));
      const found = await humanSearch(query, max);
      const image = found.image || (await shot().catch(() => undefined));
      send(res, 200, { ...(await describe()), ...found, image });
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
