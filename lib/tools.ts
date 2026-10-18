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
import { buildAskUserQuestionTool } from "@/lib/ask-user-tool";
import { buildGoalTools } from "@/lib/goals";
import { buildPlanModeTool } from "@/lib/plan-mode";
import { buildScheduleTools } from "@/lib/schedules";
import { buildAgentTools } from "@/lib/agent-tools";
import { buildPluginManagerTool } from "@/lib/plugins";


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

function buildCompanyBrainTool(opts: {
  conversationId?: string;
}) {
  return tool({
    description: `Ask the Company Brain — a FalkorDB-backed engineering knowledge graph (people, teams, services, tickets, decisions, chat) with its own agentic researcher. Use for questions about the Meridian engineering org: who knows a service, what breaks if a service fails, what is blocked, why a decision was made, bottlenecks, dependencies. It can also ACT on the graph: file/assign/update tickets, record decisions, note expertise, map open facts. Returns a grounded answer with cited node ids. The brain also remembers earlier Omnia conversations.`,
    inputSchema: z.object({
      question: z.string().describe("The question for the Company Brain, phrased concretely"),
    }),
    execute: async ({ question }) => {
      const { askAgent } = await import("@/lib/brain/agent");
      const result = await askAgent(question, {
        sessionId: opts.conversationId ? `omnia:${opts.conversationId}` : null,
        userId: "omnia",
      });
      // Threshold consolidation so tool-driven turns also build durable memory
      // (otherwise their Turns would be write-only and recall would miss them).
      if (opts.conversationId) {
        void (async () => {
          try {
            const { FalkorClient } = await import("@/lib/brain/graph");
            const { consolidateSession } = await import("@/lib/brain/memory/consolidation");
            const client = await FalkorClient.get();
            await consolidateSession(client, `omnia:${opts.conversationId}`, "omnia", {});
          } catch {
            // memory must never fail an answer
          }
        })();
      }
      return {
        answer: result.answer,
        sources: result.sources,
        agents: result.agents_involved,
        tool_calls: result.tool_count,
      };
    },
  });
}

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


const COMPUTER_SYSTEM_NOTE = `You drive a REAL Chromium browser (1280×800) shared with the user — they watch every step live in the Chromium panel. Act like PCLLM: observe (read/screenshot), then emit ONE precise action at a time (click(x,y) coordinates, type, hotkeys like Control+l). Never claim you opened a page you didn't navigate to. If a tool says the user has control, stop using the computer and explain you're waiting for them to hand it back.

Browsing like a human researcher (mandatory for factual/current/research questions):
1. START with computer_search (real Google SERP) — never jump straight to a URL from memory.
2. Pick 3–5 results from DIFFERENT domains (skip ads/aggregators), open each with computer_navigate, read with computer_read, scroll for more.
3. Cross-check the same fact across at least 2–3 sources; note disagreements; run a second computer_search with a rephrased query if coverage is thin.
4. Only then consolidate everything into one clear answer, citing sources as markdown links [title](url). Never answer from a single website.`;

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
    computer_search: tool({
      description: `Search Google the way a human does — types the query into google.com, submits, and returns the real organic results (title, url, hostname, position). ALWAYS begin any web research with this instead of guessing URLs. Then open several results from DIFFERENT domains, read them, cross-check, and consolidate. ${COMPUTER_SYSTEM_NOTE}`,
      inputSchema: z.object({
        query: z.string().describe("Concise, specific search query"),
        max: z.number().min(3).max(15).default(8).describe("How many organic results to return"),
      }),
      execute: async ({ query, max }) => {
        const blocked = await computerGuard();
        if (blocked) return { control: "user", message: blocked };
        try {
          const { chromiumSearch } = await import("@/lib/chromium");
          const r = await chromiumSearch("model", query, max);
          if (!r.results.length) {
            return {
              engine: r.engine,
              query,
              url: r.url,
              results: [],
              note: "No organic results parsed from this SERP. Refine the query, or computer_navigate to https://www.google.com and search manually.",
            };
          }
          return {
            engine: r.engine,
            query,
            url: r.url,
            results: r.results,
            note: "Open 3–5 results from DIFFERENT domains with computer_navigate, read each, cross-check facts, then consolidate citing sources as markdown links.",
          };
        } catch (e: any) {
          return { error: e.message || "search failed" };
        }
      },
    }),
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
  /** Owning run, so stopping it releases any question the tool is holding. */
  runId?: string;
}

/**
 * Session-query tools: let the model search across its own conversation history.
 * Ported from dsh-tool-session-query (session_search, session_event_read).
 * Always available — they only read what the user already has access to.
 */
function buildSessionQueryTools(opts: EnabledToolsOpts) {
  return {
    session_search: tool({
      description: `Search across your conversation history (titles and message text). Use this when you need to recall something from a prior chat — a decision, a config value, a code snippet, or an earlier finding. Results are grouped by conversation; each returns the strongest matching excerpt. Query should be a concise phrase of what you're looking for.`,
      inputSchema: z.object({
        query: z.string().describe("What to search for — a fact, phrase, or keyword"),
        limit: z.number().min(1).max(50).default(10).describe("Max conversations to return"),
      }),
      execute: async ({ query, limit }) => {
        const { listConversations, getConversation } = await import("@/lib/store");
        const { messageText } = await import("@/lib/brain/omnia-memory");
        const all = await listConversations();
        const q = query.toLowerCase();
        const results: Array<{
          id: string;
          title: string;
          snippet: string;
          score: number;
        }> = [];
        for (const c of all) {
          let bestScore = 0;
          let bestSnippet = "";
          // Match in title.
          if (c.title?.toLowerCase().includes(q)) {
            bestScore = 2;
            bestSnippet = `[Title] ${c.title}`;
          }
          // Match in messages.
          for (const m of c.messages || []) {
            const text = messageText(m as { parts?: Array<{ type: string; text?: string }> });
            if (!text) continue;
            const idx = text.toLowerCase().indexOf(q);
            if (idx >= 0) {
              const score = 1 + Math.min(idx, 0) / Math.max(text.length, 1);
              if (score > bestScore || !bestSnippet) {
                bestScore = Math.max(bestScore, score + 0.5);
                bestSnippet = text.slice(Math.max(0, idx - 60), idx + 120).replace(/\n/g, " ").trim();
              }
            }
          }
          if (bestScore > 0) {
            results.push({ id: c.id, title: c.title, snippet: bestSnippet, score: bestScore });
          }
        }
        results.sort((a, b) => b.score - a.score);
        return {
          query,
          count: results.length,
          results: results.slice(0, limit).map((r) => ({
            id: r.id,
            title: r.title,
            snippet: r.snippet,
          })),
        };
      },
    }),

    session_event_read: tool({
      description: `Read messages from a specific conversation by id. Use session_search first to find a conversation, then this tool to read its exact messages. Returns messages with roles and text content.`,
      inputSchema: z.object({
        conversation_id: z.string().describe("Conversation id (from session_search results)"),
        limit: z.number().min(1).max(100).default(50).describe("Max messages to return, most recent first"),
      }),
      execute: async ({ conversation_id, limit }) => {
        const { getConversation } = await import("@/lib/store");
        const { messageText } = await import("@/lib/brain/omnia-memory");
        const conv = await getConversation(conversation_id);
        if (!conv) return { error: "Conversation not found" };
        const items = (conv.messages || []).slice(-limit).reverse().map((m: any) => ({
          role: m.role,
          text: messageText(m),
        }));
         return {
          id: conv.id,
          title: conv.title,
          count: items.length,
          messages: items,
        };
      },
    }),

    session_event_search: tool({
      description: `Search within a specific conversation for messages matching a regex pattern. Use session_search to find the conversation id first, then this tool to dig deeper. Returns matching messages with their role, text, and position.`,
      inputSchema: z.object({
        conversation_id: z.string().describe("Conversation id"),
        pattern: z.string().describe("Regular expression to match within message text"),
        limit: z.number().min(1).max(50).default(20).describe("Max matches to return"),
      }),
      execute: async ({ conversation_id, pattern, limit }) => {
        const { getConversation } = await import("@/lib/store");
        const { messageText } = await import("@/lib/brain/omnia-memory");
        const conv = await getConversation(conversation_id);
        if (!conv) return { error: "Conversation not found" };
        const regex = new RegExp(pattern, "i");
        const results: Array<{ role: string; text: string; index: number }> = [];
        for (let i = 0; i < (conv.messages || []).length && results.length < limit; i++) {
          const m: any = (conv.messages as any[])[i];
          const text = messageText(m);
          if (regex.test(text)) {
            results.push({ role: m.role, text: text.slice(0, 300), index: i });
          }
        }
        return { pattern, count: results.length, results };
      },
    }),

    session_trace: tool({
      description: `Trace the conversation flow of a conversation, showing the sequence of user/assistant/tool events. Returns a compact timeline of message roles and (truncated) text.`,
      inputSchema: z.object({
        conversation_id: z.string().describe("Conversation id"),
        limit: z.number().min(1).max(200).default(50).describe("Max messages to trace"),
      }),
      execute: async ({ conversation_id, limit }) => {
        const { getConversation } = await import("@/lib/store");
        const { messageText } = await import("@/lib/brain/omnia-memory");
        const conv = await getConversation(conversation_id);
        if (!conv) return { error: "Conversation not found" };
        const msgs = (conv.messages || []).slice(-limit);
        const trace = msgs.map((m: any, i: number) => ({
          index: (conv.messages as any[]).length - msgs.length + i,
          role: m.role,
          text: messageText(m).slice(0, 200) || "[no text]",
        }));
        return {
          id: conv.id,
          title: conv.title,
          message_count: (conv.messages || []).length,
          trace,
        };
      },
    }),
  };
}

/**
 * Skill inspection tool (port of dsh-tool-skill).
 * Lets the model list and inspect available agent skills.
 */
function buildSkillTool() {
  return {
    skill: tool({
      description: `Inspect available agent skills (prompt modules stored in skills.json). Use 'list' to see all skills and 'inspect' to read a skill's full prompt. When a skill matches the user's request, follow its prompt instructions.`,
      inputSchema: z.object({
        action: z.enum(["list", "inspect"]).describe("list | inspect"),
        id: z.string().optional().describe("Skill id (for inspect)"),
      }),
      execute: async ({ action, id }) => {
        const { listSkills } = await import("@/lib/skills");
        const skills = await listSkills();
        if (action === "list") {
          return {
            count: skills.length,
            skills: skills.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              enabled: s.enabled,
              updated_at: s.updatedAt,
            })),
          };
        }
        if (action === "inspect") {
          if (!id) return { error: "id is required for inspect" };
          const s = skills.find((sk) => sk.id === id);
          if (!s) return { error: `Skill not found: ${id}` };
          return {
            skill: {
              id: s.id,
              name: s.name,
              description: s.description,
              prompt: s.prompt,
              source: s.source,
              enabled: s.enabled,
              updated_at: s.updatedAt,
            },
          };
        }
        return { error: "Unknown action" };
      },
    }),
  };
}

export function enabledTools(names: string[], opts: EnabledToolsOpts) {
  const map: Record<string, any> = {
    webSearch: webSearchTool,
    createArtifact: buildCreateArtifactTool(opts.conversationId),
    runAgentTask: buildRunAgentTaskTool(opts),
    companyBrain: buildCompanyBrainTool(opts),
  };
  const out: Record<string, any> = {
    // `ask_user_question` is not toggleable: it is how the agent asks for
    // confirmation or a missing decision, so it ships in every turn the way dsh
    // composes `tool-ask-user` into every preset.
    ask_user_question: buildAskUserQuestionTool(opts),
    // Session query tools (dsh-tool-session-query) are always available —
    // they only read the user's own history, no toggle needed.
    ...buildSessionQueryTools(opts),
    // Goals + schedules + plan-mode (dsh-tool-goal, dsh-tool-schedule, dsh-plan-mode).
    // These drive auto-continuation and planning semantics, so they're always on.
    ...buildGoalTools(opts.conversationId),
    ...buildScheduleTools(opts.conversationId),
    ...buildPlanModeTool(opts),

    // Session title generation (dsh-tool-session-title).
    title_session: tool({
      description: `Generate or override the title of the current session. Uses an LLM to summarize the conversation. If no title is provided, a descriptive title is generated from the conversation content.`,
      inputSchema: z.object({
        title: z.string().optional().describe("Explicit title to set (skips LLM call)"),
      }),
      execute: async ({ title }) => {
        const convId = opts.conversationId || "";
        const { getConversation, updateConversationTitle } = await import("@/lib/store");
        const { generateSessionTitle } = await import("@/lib/chat-runs");
        if (title) {
          await updateConversationTitle(convId, title);
          return { title, message: "Session title updated." };
        }
        const conv = await getConversation(convId);
        if (!conv || !conv.messages.length) {
          await updateConversationTitle(convId, "New chat");
          return { title: "New chat" };
        }
        const messages = (conv.messages || []) as Array<{
          id?: string; role: string; parts?: any[]; content?: string; tool_calls?: any;
        }>;
        const converted = messages.map((m) => ({
          id: m.id || crypto.randomUUID(),
          role: m.role as "user" | "assistant" | "system",
          parts: m.parts || [{ type: "text" as const, text: m.content || "" }],
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        }));
        const generated = await generateSessionTitle(opts.provider, opts.model, converted);
        await updateConversationTitle(convId, generated);
        return { title: generated, message: "Session title generated and saved." };
      },
    }),
  };

  // Agent management + subagent delegation (dsh-tool-subagent,
  // dsh-tool-agent-control). Always available — agents are visible across
  // the session.
  Object.assign(out, buildAgentTools({
    conversationId: opts.conversationId,
    provider: opts.provider,
    model: opts.model,
  }));

  // MCP resource tools (dsh-tool-resources). Always available so the model
  // can read MCP resources, not just call MCP tools.
  const { listMCPResources, readMCPResource, listMCPResourceTemplates } =
    require("@/lib/mcp");
  out["list_mcp_resource_templates"] = tool({
    description: `List all MCP resource templates available from connected MCP servers. Use to discover what dynamic resources (URL templates) a server exposes before reading them.`,
    inputSchema: z.object({}),
    execute: async () => {
      const templates = await listMCPResourceTemplates();
      return { count: templates.length, templates };
    },
  });
  out["list_mcp_resources"] = tool({
    description: `List all available MCP resources from connected MCP servers. Returns uri, name, mimeType, and server info. Use read_mcp_resource to read a specific resource by uri.`,
    inputSchema: z.object({}),
    execute: async () => {
      const resources = await listMCPResources();
      return { count: resources.length, resources };
    },
  });
  out["read_mcp_resource"] = tool({
    description: `Read the contents of an MCP resource identified by its URI. Use after list_mcp_resources to find the uri. Returns text content (truncated to ~20k chars) or base64-encoded binary data.`,
    inputSchema: z.object({
      uri: z.string().describe("Resource URI from list_mcp_resources"),
    }),
    execute: async ({ uri }) => {
      const result = await readMCPResource(uri);
      if (!result) return { error: `Resource not found: ${uri}` };
      const textContents: string[] = [];
      const blobContents: string[] = [];
      for (const c of result.contents) {
        if (c.text) textContents.push(c.text.slice(0, 20000));
        if (c.blob) blobContents.push(c.blob.slice(0, 512000));
      }
      return {
        uri,
        serverId: result.serverId,
        serverName: result.serverName,
        text: textContents.join("\n\n").slice(0, 20000),
        blobs: blobContents.length,
        mimeType: result.contents[0]?.mimeType,
      };
    },
  });

  // MCP tools discovery (dsh-tool-mcp-tools).
  out["list_mcp_tools"] = tool({
    description: `List all MCP tools available from connected MCP servers. Returns tool name, description, and parameter schema for each. These tools can be called directly by the model — list them first to discover what's available.`,
    inputSchema: z.object({}),
    execute: async () => {
      const { allMCPTools } = await import("@/lib/mcp");
      const tools = await allMCPTools();
      return {
        count: tools.length,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          server: t.serverId,
        })),
      };
    },
  });

  // Skill inspection tool (dsh-tool-skill).
  Object.assign(out, buildSkillTool());

  // Present tool — thin wrapper around createArtifact for presenting
  // tool results as standalone artifacts (dsh-tool-present).
  out["present"] = tool({
    description: `Present content as a standalone artifact rendered in the side panel. Use when a tool result or analysis deserves its own window (code, data, report, etc.).`,
    inputSchema: z.object({
      title: z.string().describe("Short descriptive title for the artifact"),
      type: z.enum(ARTIFACT_TYPES).default("code").describe("Artifact kind"),
      language: z.string().optional().describe("Language for code artifacts"),
      content: z.string().describe("Full artifact content"),
    }),
    execute: async ({ title, type, language, content }) => {
      const { createArtifactFile } = await import("@/lib/artifacts");
      const meta = await createArtifactFile({
        title,
        type,
        content,
        language,
        conversationId: opts.conversationId,
      });
      return {
        artifactId: meta.id,
        title: meta.title,
        type: meta.type,
        filename: meta.filename,
        url: `/api/files/${meta.id}/${encodeURIComponent(meta.filename)}`,
        message: `Artifact "${meta.title}" presented.`,
      };
    },
  });

  // Plugin manager tool (dsh-plugin-manager).
  Object.assign(out, buildPluginManagerTool());

  for (const n of names) {
    if (n === "computerUse") Object.assign(out, buildComputerTools());
    else if (map[n]) out[n] = map[n];
  }
  return out;
}
