#!/usr/bin/env node
import { report, flush } from "./report.mjs";
import { launchBrowser, screenshotDataUrl } from "./browser.mjs";
import { makePdf, makeXlsx, makeDocx, makeCsv } from "./filegen.mjs";
import { searchWeb } from "./search.mjs";
import { z } from "zod";

const [sandboxId = "local", provider = "anthropic", model = "claude-sonnet-5", engine = "tool-loop"] = process.argv.slice(2);
const TASK = process.env.AGENT_TASK || "";
const RESEARCH = process.env.AGENT_MODE === "research";

report({ type: "log", message: `Runner booting (${provider}/${model}/${engine})` });
await flush();

const AI = await import("ai");
const { tool, generateText, isStepCount } = AI;


async function buildModel() {
  switch (provider) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const opts = {};
      if (process.env.ANTHROPIC_BASE_URL) opts.baseURL = process.env.ANTHROPIC_BASE_URL;
      if (process.env.ANTHROPIC_API_KEY) opts.apiKey = process.env.ANTHROPIC_API_KEY;
      if (process.env.ANTHROPIC_AUTH_TOKEN) opts.authToken = process.env.ANTHROPIC_AUTH_TOKEN;
      return createAnthropic(opts)(model);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(model);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
      })(model);
    }
    case "ollama":
    case "lmstudio": {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      const baseURL =
        provider === "ollama"
          ? process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434/v1"
          : process.env.LMSTUDIO_BASE_URL || "http://host.docker.internal:1234/v1";
      return createOpenAICompatible({
        name: provider,
        baseURL,
        apiKey: process.env.OPENAI_API_KEY || "local",
      })(model);
    }
    case "opencode": {
      const apiKey = process.env.OPENCODE_API_KEY;
      if (!apiKey) throw new Error("OPENCODE_API_KEY is not set for the opencode provider");
      const baseURL =
        process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/v1";
      let transport = process.env.OPENCODE_TRANSPORT || "";
      if (!transport) {
        const id = String(model).toLowerCase();
        if (id.startsWith("claude-") || id.startsWith("qwen3") || id.startsWith("qwen-")) transport = "anthropic";
        else if (id.startsWith("gemini-")) transport = "gemini";
        else if (id.startsWith("gpt-") || id.startsWith("grok") || id.startsWith("muse-")) transport = "responses";
        else transport = "chat";
      }
      if (transport === "anthropic") {
        const { createAnthropic } = await import("@ai-sdk/anthropic");
        return createAnthropic({ apiKey, baseURL })(model);
      }
      if (transport === "gemini") {
        const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
        return createGoogleGenerativeAI({ apiKey, baseURL })(model);
      }
      if (transport === "chat") {
        const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
        return createOpenAICompatible({ name: "opencode", baseURL, apiKey })(model);
      }
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey, baseURL })(model);
    }
    default: {
      const baseURL = process.env.OMNIA_CUSTOM_BASE_URL;
      if (!baseURL) throw new Error(`unknown provider: ${provider}`);
      const key = process.env.OMNIA_CUSTOM_API_KEY || "custom";
      if (process.env.OMNIA_CUSTOM_PROTOCOL === "gemini") {
        const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
        const raw = baseURL.replace(/\/+$/, "").replace(/\/interactions$/i, "");
        return createGoogleGenerativeAI({
          name: provider,
          baseURL: raw || undefined,
          apiKey: key,
        }).interactions(model);
      }
      if (process.env.OMNIA_CUSTOM_PROTOCOL === "anthropic") {
        const { createAnthropic } = await import("@ai-sdk/anthropic");
        const raw = baseURL.replace(/\/+$/, "");
        return createAnthropic({
          name: provider,
          baseURL: /\/v1$/i.test(raw) ? raw : `${raw}/v1`,
          apiKey: key,
        })(model);
      }
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      return createOpenAICompatible({
        name: provider,
        baseURL,
        apiKey: key,
      })(model);
    }
  }
}


let browserPromise = null;
let page = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchBrowser(report).catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}
async function ensurePage() {
  const browser = await getBrowser();
  if (!page) page = await browser.newPage();
  return page;
}

async function openPage(url) {
  const p = await ensurePage();
  try {
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (e) {
  }
  await p.waitForTimeout(1200);
  const shot = await screenshotDataUrl(p);
  report({ type: "screenshot", image: shot });
  return p;
}

async function pageText(p, max = 6000) {
  return (await p.evaluate(() => document.body?.innerText || "")).slice(0, max);
}

function cleanResultUrl(href, base) {
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
      const enc = (u.searchParams.get("u") || "").replace(/^a1/, "");
      if (!enc) return "";
      const b64 = enc.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const out = Buffer.from(padded, "base64").toString("utf8");
      return /^https?:\/\//i.test(out) ? out : "";
    }
    if (u.hostname.includes("duckduckgo.com") && (u.pathname === "/l/" || u.pathname.endsWith("/l/"))) {
      const target = u.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
    return /^https?:\/\//i.test(u.href) ? u.href : "";
  } catch {
    return "";
  }
}

function isEngineHost(u) {
  try {
    const h = new URL(u).hostname;
    return h.includes("google.") || h.includes("bing.com") || h.includes("duckduckgo.") || h.includes("brave.com");
  } catch {
    return true;
  }
}

function finalizeResults(raw, base, max) {
  const out = [];
  const seen = new Set();
  for (const r of raw) {
    const url = cleanResultUrl(r.url, base);
    if (!url || seen.has(url) || isEngineHost(url)) continue;
    seen.add(url);
    let hostname = "";
    try {
      hostname = new URL(url).hostname.replace(/^www\./, "");
    } catch {
    }
    out.push({
      title: String(r.title || "").slice(0, 160),
      url,
      hostname,
      position: out.length + 1,
      description: "",
    });
    if (out.length >= max) break;
  }
  return out;
}

async function serpType(boxSel, query) {
  const p = await ensurePage();
  const box = p.locator(boxSel).first();
  await box.waitFor({ timeout: 12_000 });
  await box.click();
  await box.fill("");
  await box.pressSequentially(query, { delay: 25 });
  await p.waitForTimeout(400);
  await box.press("Enter");
  await p.waitForTimeout(2200);
  const shot = await screenshotDataUrl(p);
  report({ type: "screenshot", image: shot });
}

async function browserGoogleSearch(query, max) {
  const p = await ensurePage();
  await p.goto("https://www.google.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await p.waitForTimeout(900);
  await serpType('textarea[name="q"], input[name="q"]', query);
  if (p.url().includes("/sorry/") || p.url().includes("captcha")) throw new Error("google blocked");
  const raw = await p.evaluate((limit) => {
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
  const results = finalizeResults(raw, p.url(), max);
  if (!results.length) throw new Error("google empty");
  return results;
}

async function browserBingSearch(query, max) {
  const p = await ensurePage();
  await p.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  }).catch(() => {});
  await p.waitForTimeout(2200);
  const shot = await screenshotDataUrl(p);
  report({ type: "screenshot", image: shot });
  const raw = await p.evaluate((limit) => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll("li.b_algo h2 a, #b_results h2 a").forEach((a) => {
      const title = (a.innerText || "").trim();
      const href = a.getAttribute("href") || "";
      if (!title || !href || seen.has(href)) return;
      seen.add(href);
      out.push({ title: title.slice(0, 160), url: href });
    });
    return out.slice(0, limit);
  }, max);
  const results = finalizeResults(raw, p.url(), max);
  if (!results.length) throw new Error("bing empty");
  return results;
}

async function browserBraveSearch(query, max) {
  const p = await ensurePage();
  await p.goto(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  }).catch(() => {});
  await p.waitForTimeout(2500);
  const shot = await screenshotDataUrl(p);
  report({ type: "screenshot", image: shot });
  const raw = await p.evaluate((limit) => {
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
  const results = finalizeResults(raw, p.url(), max);
  if (!results.length) throw new Error("brave empty");
  return results;
}

const tools = {
  web_search: tool({
    description: "Search the web (Google via the live browser in research mode, DuckDuckGo HTML fallback). Use for current events, recent information, research, anything not in your training data. Returns ranked results with titles, snippets and URLs — open several from DIFFERENT domains, never just the first.",
    inputSchema: z.object({
      query: z.string().describe("concise, specific search query"),
      maxResults: z.number().min(1).max(15).default(8),
    }),
    execute: async ({ query, maxResults }) => {
      let results = [];
      let engine = "";
      if (RESEARCH) {
        for (const [name, fn] of [
          ["google", browserGoogleSearch],
          ["bing", browserBingSearch],
          ["brave", browserBraveSearch],
        ]) {
          try {
            results = await fn(query, maxResults || 8);
            engine = name;
            break;
          } catch (e) {
          }
        }
      }
      if (!results.length) {
        results = await searchWeb(query, maxResults || 8);
        engine = "duckduckgo";
      }
      let opened = null;
      if (RESEARCH && results.length) {
        try {
          const top = results[0];
          const p = await openPage(top.url);
          const pageTitle = await p.title().catch(() => "");
          const text = await pageText(p, 5000);
          opened = {
            url: p.url(),
            title: pageTitle || top.title,
            pageText: text,
            note: "The top result was opened. Read it, then browser_navigate OTHER results from different domains (aim for 4–6 domains) before concluding.",
          };
        } catch (e) {
        }
      }
      noteSearch(query, results, opened);
      return opened
        ? { query, engine, count: results.length, results, opened }
        : { query, engine, count: results.length, results };
    },
  }),

  browser_navigate: tool({
    description: "Open a URL in the live Chromium browser. Use for reading web pages, docs, and interactive research. A screenshot is streamed live to the user.",
    inputSchema: z.object({ url: z.string() }),
    execute: async ({ url }) => {
      const p = await openPage(url);
      const text = await pageText(p, 8000);
      const title = await p.title().catch(() => "");
      notePage(p.url() || url, title, text);
      return {
        url: p.url(),
        title,
        content: text,
        note: "A screenshot was streamed live. Read the content above; navigate further if needed.",
      };
    },
  }),

  browser_screenshot: tool({
    description: "Take a screenshot of the current browser page and stream it live to the user.",
    inputSchema: z.object({}),
    execute: async () => {
      const p = await ensurePage();
      const shot = await screenshotDataUrl(p);
      report({ type: "screenshot", image: shot });
      return { ok: true, message: "Screenshot streamed." };
    },
  }),

  browser_click: tool({
    description: "Click an element on the current page by CSS selector.",
    inputSchema: z.object({ selector: z.string() }),
    execute: async ({ selector }) => {
      const p = await ensurePage();
      await p.waitForSelector(selector, { timeout: 15_000 });
      await p.click(selector);
      await p.waitForTimeout(900);
      const shot = await screenshotDataUrl(p);
      report({ type: "screenshot", image: shot });
      const text = (await p.evaluate(() => document.body?.innerText || "")).slice(0, 4000);
      return { url: p.url(), content: text };
    },
  }),

  browser_type: tool({
    description: "Type text into an input on the current page (and optionally press Enter).",
    inputSchema: z.object({
      selector: z.string(),
      text: z.string(),
      enter: z.boolean().default(false),
    }),
    execute: async ({ selector, text, enter }) => {
      const p = await ensurePage();
      await p.waitForSelector(selector, { timeout: 15_000 });
      await p.fill(selector, "");
      await p.type(selector, text, { delay: 20 });
      if (enter) await p.keyboard.press("Enter");
      await p.waitForTimeout(1200);
      const shot = await screenshotDataUrl(p);
      report({ type: "screenshot", image: shot });
      const out = (await p.evaluate(() => document.body?.innerText || "")).slice(0, 4000);
      return { url: p.url(), content: out };
    },
  }),

  browser_extract_text: tool({
    description: "Extract readable text from the current page.",
    inputSchema: z.object({}),
    execute: async () => {
      const p = await ensurePage();
      const text = (await p.evaluate(() => document.body?.innerText || "")).slice(0, 12_000);
      return { url: p.url(), title: await p.title(), text };
    },
  }),

  exec_command: tool({
    description: "Run a shell command in the sandbox (working dir /workspace). Use for installing packages, running scripts, checking files, git, etc.",
    inputSchema: z.object({
      command: z.string().describe("shell command to run"),
    }),
    execute: async ({ command }) => {
      const { execSync } = await import("node:child_process");
      try {
        const out = execSync(command, {
          cwd: "/workspace",
          shell: "/bin/bash",
          timeout: 180_000,
          maxBuffer: 8 * 1024 * 1024,
          encoding: "utf8",
        });
        return { exitCode: 0, output: (out || "").slice(-8000) };
      } catch (e) {
        return {
          exitCode: e.status ?? -1,
          output: ((e.stdout || "") + "\n" + (e.stderr || "")).slice(-8000),
        };
      }
    },
  }),

  create_file: tool({
    description: "Write a text file (markdown, code, html, csv, json, …) into the sandbox. Use a path under /workspace/out for deliverables.",
    inputSchema: z.object({
      path: z.string().describe("path relative to /workspace, e.g. out/report.md"),
      content: z.string().describe("full file contents"),
    }),
    execute: async ({ path: rel, content }) => {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const rel0 = (rel || "").replace(/^\/+/, "");
      const target = rel0 === "workspace" || rel0.startsWith("workspace/") ? `/${rel0}` : `/workspace/${rel0}`;
      mkdirSync(target.slice(0, target.lastIndexOf("/")) || "/", { recursive: true });
      writeFileSync(target, content, "utf8");
      report({ type: "file", message: `Saved ${target}` });
      return { path: target, message: `Saved ${target}` };
    },
  }),

  create_pdf: tool({
    description: "Generate a polished PDF report. sections is a list of {heading, paragraphs: [], bullets: [], code} blocks.",
    inputSchema: z.object({
      filename: z.string().describe("e.g. report.pdf"),
      title: z.string(),
      subtitle: z.string().optional(),
      sections: z.array(
        z.object({
          heading: z.string(),
          paragraphs: z.array(z.string()).optional(),
          bullets: z.array(z.string()).optional(),
          code: z.string().optional(),
        }),
      ),
    }),
    execute: async ({ filename, title, subtitle, sections }) => {
      const outPath = `/workspace/out/${filename}`;
      await makePdf({ title, subtitle, sections }, outPath);
      report({ type: "file", message: `PDF created: ${outPath}` });
      return { path: outPath, message: `PDF created: ${outPath}` };
    },
  }),

  create_xlsx: tool({
    description: "Generate an Excel workbook. sheets is a list of {name, columns: [], rows: [[...]]} where rows are cell values matching the columns.",
    inputSchema: z.object({
      filename: z.string().describe("e.g. data.xlsx"),
      sheets: z.array(
        z.object({
          name: z.string(),
          columns: z.array(z.string()).optional(),
          rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
        }),
      ),
    }),
    execute: async ({ filename, sheets }) => {
      const outPath = `/workspace/out/${filename}`;
      await makeXlsx(sheets, outPath);
      report({ type: "file", message: `XLSX created: ${outPath}` });
      return { path: outPath, message: `XLSX created: ${outPath}` };
    },
  }),

  create_docx: tool({
    description: "Generate a Word document (.docx). paragraphs is a list of strings; optional title and headings.",
    inputSchema: z.object({
      filename: z.string().describe("e.g. notes.docx"),
      title: z.string().optional(),
      paragraphs: z.array(z.string()),
    }),
    execute: async ({ filename, title, paragraphs }) => {
      const outPath = `/workspace/out/${filename}`;
      await makeDocx({ title, paragraphs }, outPath);
      report({ type: "file", message: `DOCX created: ${outPath}` });
      return { path: outPath, message: `DOCX created: ${outPath}` };
    },
  }),

  create_csv: tool({
    description: "Generate a CSV file.",
    inputSchema: z.object({
      filename: z.string().describe("e.g. data.csv"),
      rows: z.array(z.array(z.string())),
    }),
    execute: async ({ filename, rows }) => {
      const outPath = `/workspace/out/${filename}`;
      await makeCsv(rows, outPath);
      report({ type: "file", message: `CSV created: ${outPath}` });
      return { path: outPath, message: `CSV created: ${outPath}` };
    },
  }),
};


const BASE_SYSTEM = `You are Omnia Agent — an autonomous worker inside an isolated Docker sandbox on the user's machine.

Environment:
- Working directory: /workspace
- Save deliverables to /workspace/out (PDF, DOCX, XLSX, CSV, Markdown, HTML, images…).
- You have a live Chromium browser for web research (navigate, click, type, screenshot).
- You have a full shell (exec_command) and file generation tools.

Task: ${TASK}

Working style:
1. Break the task into concrete steps and execute them one by one.
2. For research: use web_search first, then open promising pages with browser_navigate and read them.
3. Produce polished, complete deliverables. A good report is detailed, well-structured, and accurate.
4. After producing files, briefly summarize what you did and exactly which files you created under /workspace/out.
5. Never claim you did something you didn't. If you can't finish, say so clearly.`;

const RESEARCH_SYSTEM = `You are Omnia Research — a deep-web-research agent with a live Chromium browser inside an isolated Docker sandbox.

This task is RESEARCH. Answering from search snippets or from memory is NOT acceptable — you must actually open and read multiple web pages in the browser, like a careful human would.

Your job is to GATHER EVIDENCE (a separate step will write the final briefing file, so do not worry about saving it yourself):

1. Use web_search to discover candidate sources (the top result is auto-opened — read its content). Run 2–3 DIFFERENT queries (rephrase, add year, add synonyms) until you have plenty of candidates.
2. Open the most promising URLs with browser_navigate and actually READ them (browser_extract_text, scroll for more). Visit pages on at least 4–6 different domains; prefer primary/current sources (official docs, papers, reputable outlets) over SEO aggregators.
3. Cross-check every important fact across at least 2–3 sources. Note where sources disagree. If coverage is thin, run another query rather than settling.
4. Extract concrete facts, figures, dates and quotes from the pages you actually opened. Keep notes as you go — every tool result is recorded.
5. When you have read enough (or run out of useful sources), finish with a short plain-text summary of your findings that CONSOLIDATES everything (themes, agreements, disagreements). Do NOT attempt to save files — the briefing is assembled automatically from everything you read.

Rules:
- Never claim you read a page you did not open. If a page fails to load, say so and move to another source.
- Never answer from one website — breadth and cross-checking matter more than speed.
- Keep going until you have opened pages on at least 4 different domains across at least 2 searches, or there is genuinely nothing more to find.

Task: ${TASK}`;

const SYSTEM = RESEARCH ? RESEARCH_SYSTEM : BASE_SYSTEM;


const evidence = { searches: [], pages: [] };

function normUrl(u) {
  try {
    const x = new URL(String(u || ""));
    return (x.hostname + x.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(u || "").toLowerCase();
  }
}

function domainOf(u) {
  try {
    return new URL(String(u)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function notePage(url, title, text) {
  if (!url) return;
  const n = normUrl(url);
  if (evidence.pages.some((p) => normUrl(p.url) === n)) return;
  evidence.pages.push({
    url,
    title: title || url,
    text: String(text || "").slice(0, 8000),
  });
}

function noteSearch(query, results, opened) {
  evidence.searches.push({
    query,
    results: (results || []).slice(0, 8).map((r) => ({
      title: r.title || "",
      url: r.url || "",
      desc: String(r.description || "").slice(0, 400),
    })),
  });
  if (opened && opened.url) {
    notePage(opened.url, opened.title || "", opened.pageText || "");
  }
}


async function runToolLoop(model) {
  report({ type: "status", value: "ready" });
  report({ type: "log", message: `Starting tool loop with ${provider}/${model}` });

  const result = await generateText({
    model,
    system: SYSTEM,
    prompt: TASK,
    tools,
    stopWhen: isStepCount(32),
    maxOutputTokens: 32_768,
    temperature: 0.7,
    onStepFinish: ({ text, reasoning, tools: stepTools, finishReason }) => {
      if (reasoning?.length) {
        const r = reasoning[reasoning.length - 1];
        report({ type: "thinking", message: (r?.text || "").slice(0, 500) });
      }
      if (stepTools?.length) {
        for (const t of stepTools) {
          const name = t.toolName || t.name;
          const args = t.input || t.args;
          const argsStr =
            args && typeof args === "object"
              ? JSON.stringify(args).slice(0, 300)
              : String(args || "");
          report({ type: "tool", message: `→ ${name} ${argsStr}` });
        }
      }
      if (text) report({ type: "text", message: text.slice(0, 500) });
      report({ type: "progress", value: Math.min(92, 18 + stepIndex() * 9) });
      report({ type: "status", value: "busy" });
    },
  });

  const final = result?.text || "";
  report({ type: "text", message: final.slice(0, 2000) });
  return final;
}


async function postGeminiWithRetry(url, apiKey, body) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      const retryMs = Math.max(Number(res.headers.get("retry-after") || 0) * 1000, 6000);
      report({ type: "log", message: `Gemini API ${res.status} (attempt ${attempt}/4) — retrying in ${Math.round(retryMs / 1000)}s` });
      await sleep(retryMs);
      continue;
    }
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status}: ${txt.slice(0, 500)}`);
  }
  throw new Error("Gemini API: gave up after 4 attempts (rate limit/quota)");
}

function declParams(schema) {
  let js;
  try {
    js = z.toJSONSchema(schema);
  } catch {
    return { type: "object", properties: {} };
  }
  const clean = (n) => {
    if (Array.isArray(n)) return n.map(clean);
    if (n && typeof n === "object") {
      const o = {};
      for (const [k, v] of Object.entries(n)) {
        if (k === "$schema" || k === "additionalProperties") continue;
        o[k] = clean(v);
      }
      if (Array.isArray(o.type)) {
        const set = [...new Set(o.type)];
        const nullable = set.includes("null");
        const nonNull = set.filter((t) => t !== "null");
        let t;
        if (nonNull.length === 1) t = nonNull[0];
        else if (nonNull.includes("string")) t = "string";
        else if (nonNull.includes("number")) t = "number";
        else if (nonNull.includes("integer")) t = "integer";
        else if (nonNull.includes("boolean")) t = "boolean";
        else t = nonNull[0] || "string";
        o.type = t;
        if (nullable) o.nullable = true;
      }
      return o;
    }
    return n;
  };
  return clean(js);
}

function trimResult(value) {
  let str;
  try {
    str = JSON.stringify(value);
  } catch {
    return { error: "unserializable tool result" };
  }
  if (str.length <= 100_000) return value;
  const cap = (n) => {
    if (Array.isArray(n)) return n.slice(0, 200).map(cap);
    if (n && typeof n === "object") {
      const o = {};
      for (const [k, v] of Object.entries(n)) o[k] = cap(v);
      return o;
    }
    if (typeof n === "string") return n.slice(0, 4000);
    return n;
  };
  return cap(value);
}

async function runGeminiRawLoop() {
  const { endpoint, apiKey, modelId } = geminiConfig();

  report({ type: "status", value: "ready" });
  report({ type: "log", message: `Starting raw gemini tool loop (${modelId})` });

  const declarations = Object.entries(tools).map(([name, td]) => ({
    name,
    description: td.description || "",
    parameters: declParams(td.inputSchema),
  }));

  const contents = [{ role: "user", parts: [{ text: TASK }] }];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let finalText = "";

  for (let step = 0; step < 34; step++) {
    report({ type: "progress", value: Math.min(92, 14 + step * 3) });
    report({ type: "status", value: "busy" });
    const res = await postGeminiWithRetry(endpoint, apiKey, {
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents,
      tools: [{ functionDeclarations: declarations }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 16_384 },
    });
    const data = await res.json();
    const cand = data?.candidates?.[0];
    if (!cand) {
      throw new Error("Gemini returned no candidate: " + JSON.stringify(data?.promptFeedback || data).slice(0, 400));
    }
    const parts = cand.content?.parts || [];
    for (const p of parts) {
      if (!p.functionCall && (p.text || "").trim()) {
        if (p.thought) {
          report({ type: "thinking", message: String(p.text).slice(0, 500) });
          console.error(`[raw] think: ${String(p.text).slice(0, 120)}`);
        } else {
          report({ type: "text", message: String(p.text).slice(0, 500) });
          console.error(`[raw] text: ${String(p.text).slice(0, 120)}`);
        }
      }
    }
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      finalText = parts.map((p) => p.text || "").join("");
      console.error(`[raw] final (${finalText.length} chars)`);
      if (finalText) report({ type: "text", message: finalText.slice(0, 2000) });
      break;
    }

    contents.push({
      role: "model",
      parts: calls.map((p) => ({
        functionCall: p.functionCall,
        ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}),
      })),
    });

    const responses = [];
    for (const p of calls) {
      const fn = p.functionCall;
      const td = tools[fn.name];
      const argsTxt = JSON.stringify(fn.args || {}).slice(0, 160);
      console.error(`[raw] → ${fn.name} ${argsTxt}`);
      report({ type: "tool", message: `→ ${fn.name} ${JSON.stringify(fn.args || {}).slice(0, 300)}` });
      let out;
      if (td?.execute) {
        try {
          out = await td.execute(fn.args || {});
        } catch (e) {
          out = { error: String(e?.message || e).slice(0, 500) };
        }
      } else {
        out = { error: `Unknown tool: ${fn.name}` };
      }
      out = trimResult(out);
      console.error(`[raw]   ← ${fn.name}`, JSON.stringify(out).slice(0, 160));
      responses.push({ functionResponse: { name: fn.name, response: out } });
    }
    contents.push({ role: "user", parts: responses });
    report({ type: "log", message: `Round ${step + 1}: executed ${responses.length} tool call(s)` });
    console.error(`[raw] round ${step + 1}: ${responses.length} tool(s) done`);
    await sleep(2000);
  }

  return finalText;
}

function geminiConfig() {
  const base = (process.env.OMNIA_CUSTOM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta")
    .replace(/\/+$/, "")
    .replace(/\/interactions$/i, "");
  const apiKey = process.env.OMNIA_CUSTOM_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
  const modelId = String(model).replace(/^models\//, "");
  const endpoint = `${base}/models/${encodeURIComponent(modelId)}:generateContent`;
  return { base, apiKey, modelId, endpoint };
}

let _step = 0;
function stepIndex() {
  return ++_step;
}


async function runAgentSdkEngine(model) {
  let queryFn;
  try {
    ({ query: queryFn } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch {
    report({ type: "error", message: "Agent SDK not installed in this image — falling back to tool-loop." });
    return runToolLoop(model);
  }

  report({ type: "status", value: "ready" });
  report({ type: "log", message: `Starting Claude Agent SDK run (${model})` });

  const result = await queryFn({
    permissionMode: "bypassPermissions",
    options: {
      model,
      maxTurns: 40,
      cwd: "/workspace",
      includePartialMessages: true,
      allowedTools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite"],
    },
    prompt: `${SYSTEM}\n\nBegin the task now.`,
    onUpdate: (update) => {
      if (update.type !== "stream_event") return;
      const evt = update.event;
      switch (evt.type) {
        case "thinking":
          report({ type: "thinking", message: (evt.thinking || "").slice(0, 500) });
          break;
        case "text":
          report({ type: "text", message: (evt.text || "").slice(0, 500) });
          break;
        case "tool_use":
          report({ type: "tool", message: `→ ${evt.name} ${JSON.stringify(evt.input || {}).slice(0, 300)}` });
          break;
        case "subagent_start":
          report({ type: "log", message: `Spawning subagent: ${evt.name || evt.prompt?.slice(0, 60)}` });
          break;
        case "result":
          report({ type: "log", message: (evt.result || "").slice(0, 2000) });
          break;
        case "progress":
          report({ type: "progress", value: Math.min(95, Number(evt.value) || 0) });
          break;
        default:
          break;
      }
    },
  });

  return typeof result === "string" ? result : JSON.stringify(result).slice(0, 2000);
}


const SYNTH_SYSTEM = `You are a research editor. Write a comprehensive, beautifully structured Markdown briefing from the evidence below.

Required sections:
# (title)
## Overview — 3–6 sentences on what this is about and why it matters now
## Key Findings — 5–10 crisp bullets with the most important facts, figures, dates, model names
## Details — grouped subsections with the specifics found across sources
## Sources — bullet list of the page URLs actually opened (use exactly the URLs given)

Rules:
- Only use facts present in the evidence. Never invent benchmarks, dates, or URLs.
- Cite inline where each fact came from (site name in parentheses).
- No placeholders, no "as an AI", no meta-commentary. Write the finished briefing only.`;

async function ensureCoverage() {
  const TARGET_PAGES = 6;
  const MAX_AUTO_OPENS = 5;
  if (!evidence.searches.length) return;
  const perDomain = {};
  for (const p of evidence.pages) {
    const d = domainOf(p.url);
    perDomain[d] = (perDomain[d] || 0) + 1;
  }
  const candidates = [];
  for (const s of evidence.searches) {
    for (const r of (s.results || [])) {
      if (!/^https?:\/\//i.test(r.url || "")) continue;
      if (evidence.pages.some((p) => normUrl(p.url) === normUrl(r.url))) continue;
      if (candidates.some((c) => normUrl(c.url) === normUrl(r.url))) continue;
      const d = domainOf(r.url);
      if ((perDomain[d] || 0) >= 2) continue;
      perDomain[d] = (perDomain[d] || 0) + 1;
      candidates.push(r);
      if (evidence.pages.length + candidates.length >= TARGET_PAGES) break;
    }
    if (evidence.pages.length + candidates.length >= TARGET_PAGES) break;
  }
  let i = 0;
  for (const c of candidates.slice(0, MAX_AUTO_OPENS)) {
    i++;
    report({ type: "log", message: `Coverage ${i}/${Math.min(candidates.length, MAX_AUTO_OPENS)}: opening ${c.url}` });
    try {
      const p = await openPage(c.url);
      const title = await p.title().catch(() => c.title || "");
      const text = await pageText(p, 8000);
      notePage(p.url() || c.url, title, text);
      report({ type: "log", message: `Coverage: extracted ${(text || "").length} chars from ${domainOf(c.url)}` });
    } catch (e) {
      report({ type: "log", message: `Coverage skip ${c.url}: ${e?.message || e}` });
    }
  }
  report({
    type: "log",
    message: `Evidence: ${evidence.pages.length} page(s) read, ${evidence.searches.length} search(es) run`,
  });
}

function evidenceText(maxChars = 60_000) {
  const chunks = [];
  evidence.searches.forEach((s, i) => {
    chunks.push(`SEARCH ${i + 1}: ${s.query}`);
    for (const r of s.results || []) {
      chunks.push(`- ${r.title} | ${r.url}${r.desc ? ` — ${r.desc}` : ""}`);
    }
  });
  evidence.pages.forEach((p, i) => {
    chunks.push(`\n===== PAGE ${i + 1}: ${p.title}\nURL: ${p.url}\n${p.text}`);
  });
  const full = chunks.join("\n");
  return full.length > maxChars ? full.slice(0, maxChars) + "\n\n[evidence truncated]" : full;
}

function evidenceDump() {
  const lines = [`# Research Briefing`, ``, `Task: ${TASK}`, ``, `## Searches run`, ``];
  evidence.searches.forEach((s, i) => {
    lines.push(`### ${i + 1}. ${s.query}`, ``);
    for (const r of s.results || []) lines.push(`- [${r.title}](${r.url})${r.desc ? ` — ${r.desc}` : ""}`);
    lines.push(``);
  });
  lines.push(`## Pages read`, ``);
  evidence.pages.forEach((p, i) => {
    lines.push(`### ${i + 1}. ${p.title}`, ``, `Source: ${p.url}`, ``, p.text, ``);
  });
  return lines.join("\n");
}

async function synthesizeBriefing(modelObj, gemRaw) {
  const context = evidenceText();
  if (!context.trim()) throw new Error("no evidence collected");
  const prompt = `TASK:\n${TASK}\n\nEVIDENCE:\n${context}`;
  if (gemRaw) {
    const { endpoint, apiKey, modelId } = geminiConfig();
    report({ type: "log", message: `Synthesizing briefing with ${modelId} (${context.length} chars of evidence)` });
    const res = await postGeminiWithRetry(endpoint, apiKey, {
      system_instruction: { parts: [{ text: SYNTH_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 16384 },
    });
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || "").join("");
  }
  report({ type: "log", message: `Synthesizing briefing (${context.length} chars of evidence)` });
  const result = await generateText({
    model: modelObj,
    system: SYNTH_SYSTEM,
    prompt,
    maxOutputTokens: 16384,
    temperature: 0.5,
  });
  return result?.text || "";
}

async function saveBriefing(markdown) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync("/workspace/out", { recursive: true });
  const outPath = "/workspace/out/briefing.md";
  let md = String(markdown || "").trim();
  if (!md) {
    report({ type: "log", message: "Synthesis empty — writing raw evidence dump instead" });
    md = evidenceDump();
  }
  if (!md.startsWith("#")) md = `# Research Briefing\n\n${md}`;
  writeFileSync(outPath, md, "utf8");
  report({ type: "file", message: `Saved ${outPath}` });
  report({ type: "log", message: `Briefing written (${(md.length / 1024).toFixed(1)} KB)` });
  return outPath;
}


try {
  const gemRaw =
    process.env.OMNIA_CUSTOM_PROTOCOL === "gemini" ||
    (provider === "google" && (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY));

  const modelObj = await buildModel();
  report({ type: "log", message: "Model ready" });

  let engineFn;
  let engineArg;
  if (engine === "agent-sdk") {
    engineFn = runAgentSdkEngine;
    engineArg = modelObj;
  } else if (gemRaw) {
    engineFn = runGeminiRawLoop;
    engineArg = null;
  } else {
    engineFn = runToolLoop;
    engineArg = modelObj;
  }
  await engineFn(engineArg);

  if (RESEARCH) {
    try {
      await ensureCoverage();
      const md = await synthesizeBriefing(engineArg, gemRaw);
      await saveBriefing(md);
    } catch (e) {
      console.error("[runner] briefing pipeline:", (e?.message || String(e)).slice(0, 500));
      report({ type: "error", message: `briefing pipeline: ${e?.message || String(e)}` });
      try {
        await saveBriefing("");
      } catch {
      }
    }
  }

  report({ type: "status", value: "done" });
  report({ type: "done", message: "Agent finished" });
  report({ type: "progress", value: 100 });
  await flush();
  if (browserPromise) await browserPromise.then((b) => b.close()).catch(() => {});
  process.exit(0);
} catch (e) {
  console.error("[runner] fatal:", (e?.stack || e?.message || String(e)).slice(0, 2000));
  report({ type: "error", message: (e?.stack || e?.message || String(e)).slice(0, 2000) });
  report({ type: "status", value: "error", message: e?.message || String(e) });
  await flush();
  process.exit(1);
}
