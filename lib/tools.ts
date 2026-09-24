import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { searchWeb, rankResults } from "@/lib/search";
import { createArtifactFile } from "@/lib/artifacts";
import { spawnAgent, getAgent } from "@/lib/agents";
import {
  chromiumClick,
  chromiumNav,
  chromiumNavigate,
  chromiumPress,
  chromiumRead,
  chromiumScroll,
  chromiumShot,
  chromiumType,
  ensureChromium,
  getControl,
} from "@/lib/chromium";
import type { ArtifactType } from "@/lib/types";


const ARTIFACT_TYPES: ArtifactType[] = [
  "text",
  "code",
  "markdown",
  "html",
  "svg",
  "table",
  "mermaid",
];

export const webSearchTool = tool({
  description: `Search the web. Use this for current events, recent information, prices, news, research, or anything not in your training data. Returns ranked results with titles, snippets and URLs. IMPORTANT citation rule: every factual claim in your answer MUST end with an inline citation like [1], [2] referring to the result NUMBER in the order returned (result 1 → [1], result 2 → [2], …). Never invent citations; only cite results actually returned. Example: "The launch is in June [1][3]."`,
  inputSchema: z.object({
    query: z.string().describe("The search query, concise and specific"),
    maxResults: z.number().min(1).max(15).default(8).describe("How many results to return"),
  }),
  execute: async ({ query, maxResults }) => {
    const results = await searchWeb(query, maxResults ?? 8);
    const ranked = rankResults(results, query).slice(0, maxResults ?? 8);
    if (!ranked.length) {
      return {
        query,
        count: 0,
        results: [],
        message: "No results found. Try rephrasing the query or splitting it into smaller searches.",
      };
    }
    const numbered = ranked.map((r, i) => ({ n: i + 1, ...r }));
    return {
      query,
      count: numbered.length,
      results: numbered,
      citationNote: "Cite facts as [n] using the result's n above.",
    };
  },
});

function buildCreateArtifactTool(conversationId?: string) {
  return tool({
    description: `Create a rich, standalone artifact (rendered in the side panel) — code, markdown doc, HTML page, SVG diagram, mermaid diagram, or table. Use for anything that deserves its own window rather than chat text.`,
    inputSchema: z.object({
      title: z.string().describe("Short descriptive title, e.g. 'Sales Dashboard UI'"),
      type: z
        .enum(ARTIFACT_TYPES)
        .default("code")
        .describe("artifact kind"),
      language: z
        .string()
        .optional()
        .describe("Programming language for code artifacts (python, typescript, html, …)"),
      content: z.string().describe("The full artifact content"),
    }),
    execute: async ({ title, type, language, content }) => {
      const meta = await createArtifactFile({
        title,
        type,
        content,
        language,
        conversationId,
      });
      return {
        artifactId: meta.id,
        title: meta.title,
        type: meta.type,
        filename: meta.filename,
        url: `/api/files/${meta.id}/${encodeURIComponent(meta.filename)}`,
        message: `Artifact created: "${meta.title}" (${meta.type}).`,
      };
    },
  });
}

function buildRunAgentTaskTool(opts: {
  provider: string;
  model: string;
  conversationId?: string;
}) {
  const provider = opts.provider || "anthropic";
  const model = opts.model || "claude-sonnet-5";
  return tool({
    description: `Run a task in an isolated Docker sandbox (an "agent"). Use for generating PDF/DOCX/XLSX/CSV/markdown deliverables, running and testing multi-file code, deep web research with a live Chromium browser, scraping, batch file work, or anything that needs a shell + filesystem. The agent runs autonomously on the current conversation model (${provider}/${model}) and its output files are saved to /workspace/out and become viewable/downloadable files in the chat. For deep research on current topics set research: true so the agent actually opens and reads web pages in a live browser — it must still produce files.`,
    inputSchema: z.object({
      task: z.string().describe("Precise instructions for the agent. Be specific about the deliverable, format, and where files should be saved (/workspace/out)."),
      research: z
        .boolean()
        .default(false)
        .describe("If true the agent browses the web in a live Chromium browser (web_search then open & read the actual pages), cross-checks sources, and saves a cited briefing to /workspace/out. Set true for research on current/unfamiliar topics; leave false for pure file/code generation."),
      wait: z
        .boolean()
        .default(true)
        .describe("If true, wait for completion (up to maxWaitSeconds) and return the outcome"),
      maxWaitSeconds: z.number().min(5).max(900).default(300),
    }),
    execute: async ({ task, research, wait, maxWaitSeconds }) => {
      const agent = await spawnAgent({
        task,
        provider,
        model,
        engine: "tool-loop",
        conversationId: opts.conversationId,
        research,
      });

      if (!wait) {
        return {
          agentId: agent.id,
          message: `Agent ${agent.id} launched in a Docker sandbox. Track it in the Agents panel.`,
        };
      }

      const deadline = Date.now() + (maxWaitSeconds || 300) * 1000;
      let last: any = agent;
      while (Date.now() < deadline) {
        await sleep(1500);
        last = getAgent(agent.id);
        if (!last) break;
        if (["done", "failed", "stopped"].includes(last.status)) break;
      }

      if (!last) return { agentId: agent.id, message: "Agent record was cleaned up." };
      const files = last.resultFiles || [];
      const fileList = files.map((f: any) => ({
        name: f.title || f.filename,
        url: `/api/files/${f.id}/${encodeURIComponent(f.filename)}`,
        id: f.id,
        type: f.type,
        filename: f.filename,
      }));
      const logTail = (last.log || [])
        .slice(-6)
        .map((l: any) => `${l.message}`)
        .join("\n");
      const stillRunning = ["queued", "starting", "running"].includes(last.status);
      return {
        agentId: agent.id,
        status: last.status,
        progress: last.progress,
        files: stillRunning ? [] : fileList,
        summary: stillRunning
          ? `Agent is still running in the background (${provider}/${model}). Track progress in the Agents panel — any files it produces will show up there when it finishes.`
          : `Agent ${last.status}: ${files.length} file(s) produced.\n${logTail}`,
      };
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


const COMPUTER_SYSTEM_NOTE = `You drive a REAL Chromium browser (1280×800) shared with the user — they watch every step live in the Chromium panel. Act like PCLLM: observe (read/screenshot), then emit ONE precise action at a time (click(x,y) coordinates, type, hotkeys like Control+l). Never claim you opened a page you didn't navigate to. If a tool says the user has control, stop using the computer and explain you're waiting for them to hand it back.`;

async function computerGuard() {
  if ((await getControl()) === "user") {
    return "The user has taken control of Chromium in the UI — do NOT use computer tools right now. Tell the user you're waiting for them to hand control back (Chromium panel → Give back to model).";
  }
  try {
    await ensureChromium();
  } catch (e: any) {
    return `Chromium is unavailable: ${e.message || e}. Continue without the browser and say so.`;
  }
  return null;
}

function compactResult(r: { url: string; title: string; text?: string }) {
  return {
    url: r.url,
    title: r.title,
    text: (r.text || "").slice(0, 6000),
    note: "A screenshot of this step was recorded to the Chromium timeline the user can scrub through.",
  };
}

function buildComputerTools() {
  return {
    computer_navigate: tool({
      description: `Open a URL in the shared Chromium browser. Use whenever you need to READ a website (docs, articles, dashboards) or the user asks you to go somewhere. The page screenshot is recorded. ${COMPUTER_SYSTEM_NOTE}`,
      inputSchema: z.object({ url: z.string().describe("Full http(s) URL to open") }),
      execute: async ({ url }) => {
        const blocked = await computerGuard();
        if (blocked) return { control: "user", message: blocked };
        try {
          const r = await chromiumNavigate("model", url);
          const text = (await chromiumRead().catch(() => ({ text: "" })) as any).text || "";
          return compactResult({ ...r, text });
        } catch (e: any) {
          return { error: e.message || "navigate failed" };
        }
      },
    }),
    computer_click: tool({
      description: `Click at page coordinates (viewport is 1280×800, origin top-left) or a CSS selector. Read the page first, then click precisely — buttons, links, tabs. ${COMPUTER_SYSTEM_NOTE}`,
      inputSchema: z.object({
        x: z.number().min(0).max(1280).optional().describe("X coordinate"),
        y: z.number().min(0).max(800).optional().describe("Y coordinate"),
        selector: z.string().optional().describe("CSS selector alternative to coordinates"),
      }),
      execute: async ({ x, y, selector }) => {
        const blocked = await computerGuard();
        if (blocked) return { control: "user", message: blocked };
        try {
          const { chromiumClickSelector } = await import("@/lib/chromium");
          const r =
            selector && (x === undefined || y === undefined)
              ? await chromiumClickSelector("model", selector)
              : await chromiumClick("model", x ?? 640, y ?? 400);
          const text = (await chromiumRead().catch(() => ({ text: "" })) as any).text || "";
          return compactResult({ ...r, text });
        } catch (e: any) {
          return { error: e.message || "click failed" };
        }
      },
    }),
    computer_type: tool({
      description: `Type into the focused element on the page (click a field first if needed). Set enter=true to submit (search boxes, logins). ${COMPUTER_SYSTEM_NOTE}`,
      inputSchema: z.object({
        text: z.string().describe("Text to type"),
        enter: z.boolean().default(false).describe("Press Enter after typing"),
      }),
      execute: async ({ text, enter }) => {
        const blocked = await computerGuard();
        if (blocked) return { control: "user", message: blocked };
        try {
          const r = await chromiumType("model", text, enter);
          const after = (await chromiumRead().catch(() => ({ text: "" })) as any).text || "";
          return compactResult({ ...r, text: after });
        } catch (e: any) {
          return { error: e.message || "type failed" };
        }
      },
    }),
    computer_press: tool({
      description: `Press a key or hotkey (Enter, Escape, Tab, Control+l, Control+c …). For shortcuts and dismissing dialogs. ${COMPUTER_SYSTEM_NOTE}`,
      inputSchema: z.object({ key: z.string().describe("Key or hotkey, e.g. Enter, Escape, Control+l") }),
      execute: async ({ key }) => {
        const blocked = await computerGuard();
        if (blocked) return { control: "user", message: blocked };
        try {
          const r = await chromiumPress("model", key);
          return compactResult(r);
        } catch (e: any) {
          return { error: e.message || "press failed" };
        }
      },
    }),
    computer_scroll: tool({
      description: `Scroll the page up/down to reveal more content before reading or clicking. ${COMPUTER_SYSTEM_NOTE}`,
      inputSchema: z.object({
        direction: z.enum(["up", "down"]).default("down"),
      }),
      execute: async ({ direction }) => {
        const blocked = await computerGuard();
        if (blocked) return { control: "user", message: blocked };
        try {
          const r = await chromiumScroll("model", direction);
          return compactResult(r);
        } catch (e: any) {
          return { error: e.message || "scroll failed" };
        }
      },
    }),
    computer_read: tool({
      description: `Read the current page text (no screenshot spam). Use after navigating to actually READ the website content. ${COMPUTER_SYSTEM_NOTE}`,
      inputSchema: z.object({}),
      execute: async () => {
        const blocked = await computerGuard();
        if (blocked) return { control: "user", message: blocked };
        try {
          const r = await chromiumRead();
          return { url: r.url, title: r.title, text: (r.text || "").slice(0, 12000) };
        } catch (e: any) {
          return { error: e.message || "read failed" };
        }
      },
    }),
    computer_screenshot: tool({
      description: `Look at the current page visually (layout, buttons, images). Records a screenshot step. ${COMPUTER_SYSTEM_NOTE}`,
      inputSchema: z.object({}),
      execute: async () => {
        const blocked = await computerGuard();
        if (blocked) return { control: "user", message: blocked };
        try {
          const { recordStep } = await import("@/lib/chromium");
          const r = await chromiumShot();
          await recordStep({
            actor: "model",
            action: "screenshot",
            detail: "looked at the page",
            url: r.url,
            title: r.title,
            shot: r.image,
          });
          return { url: r.url, title: r.title, message: "Screenshot recorded to the Chromium timeline." };
        } catch (e: any) {
          return { error: e.message || "screenshot failed" };
        }
      },
    }),
    computer_nav: tool({
      description: `Browser back / forward / reload on the shared Chromium page. ${COMPUTER_SYSTEM_NOTE}`,
      inputSchema: z.object({ op: z.enum(["back", "forward", "reload"]) }),
      execute: async ({ op }) => {
        const blocked = await computerGuard();
        if (blocked) return { control: "user", message: blocked };
        try {
          const r = await chromiumNav("model", op);
          return compactResult(r);
        } catch (e: any) {
          return { error: e.message || `${op} failed` };
        }
      },
    }),
  };
}

export interface EnabledToolsOpts {
  provider: string;
  model: string;
  conversationId?: string;
}

export function enabledTools(names: string[], opts: EnabledToolsOpts) {
  const map: Record<string, any> = {
    webSearch: webSearchTool,
    createArtifact: buildCreateArtifactTool(opts.conversationId),
    runAgentTask: buildRunAgentTaskTool(opts),
  };
  const out: Record<string, any> = {};
  for (const n of names) {
    if (n === "computerUse") Object.assign(out, buildComputerTools());
    else if (map[n]) out[n] = map[n];
  }
  return out;
}
