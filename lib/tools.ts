import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { searchWeb, rankResults } from "@/lib/search";
import { createArtifactFile } from "@/lib/artifacts";
import { spawnAgent, getAgent } from "@/lib/agents";
import type { ArtifactType } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Chat tool definitions (used by /api/chat + the sandbox runner)     */
/* ------------------------------------------------------------------ */

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
    // Numbered explicitly so the model cites [1..N] in result order.
    const numbered = ranked.map((r, i) => ({ n: i + 1, ...r }));
    return {
      query,
      count: numbered.length,
      results: numbered,
      citationNote: "Cite facts as [n] using the result's n above.",
    };
  },
});

/** Create a chat artifact (bound to the active conversation so it persists
 *  in that conversation's artifact list instead of being dropped on reload). */
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

/**
 * Spawn a sandboxed agent to actually do work (docs, code, research with a
 * browser). Blocks up to `maxWaitSeconds` and returns a summary; the frontend
 * shows the live agent run in the Agents panel.
 *
 * The tool is *bound* to the conversation's own provider + model (whatever is
 * answering the chat). Agents must run on a provider the user has actually
 * configured — the built-in defaults (anthropic/openai) fail when no API key
 * is present, which is why the tool does NOT let the model pick a provider.
 * Use the Agents panel if you want an agent on a different provider.
 */
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

export interface EnabledToolsOpts {
  provider: string;
  model: string;
  /** active conversation the tool runs in — artifacts/agents are tied to it */
  conversationId?: string;
}

/** Which tools are enabled based on user settings + provider config. */
export function enabledTools(names: string[], opts: EnabledToolsOpts) {
  const map: Record<string, any> = {
    webSearch: webSearchTool,
    createArtifact: buildCreateArtifactTool(opts.conversationId),
    runAgentTask: buildRunAgentTaskTool(opts),
  };
  const out: Record<string, any> = {};
  for (const n of names) {
    if (map[n]) out[n] = map[n];
  }
  return out;
}
