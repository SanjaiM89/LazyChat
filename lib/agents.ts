import "server-only";

import { nanoid } from "nanoid";
import type { AgentMeta, AgentLogEntry, AgentStatus } from "@/lib/types";
import {
  createSandbox,
  deleteSandbox,
  sandboxDownload,
  sandboxResultFiles,
} from "@/lib/sandbox";
import { importArtifactFile } from "@/lib/artifacts";
import { isBuiltinProvider, getOpencodeTransport } from "@/lib/models";
import { PROVIDERS } from "@/lib/models";
import type { BuiltinProviderId } from "@/lib/types";
import { getStoredProviderKey } from "@/lib/provider-keys";
import { getCustomProvider, resolveApiKey } from "@/lib/custom-providers";
import type { ArtifactType } from "@/lib/types";


interface AgentRecord extends AgentMeta {
  listeners: Set<(a: AgentMeta) => void>;
  abort?: AbortController;
  image?: string;
  research?: boolean;
}

const agents = new Map<string, AgentRecord>();

const RESEARCH_RE =
  /\b(research(?:ing|ed)?|investigat\w+|deep ?dive|deep ?research|current events|briefing)\b/i;

const EXT_TO_TYPE: Record<string, ArtifactType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".csv": "csv",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".html": "html",
  ".htm": "html",
  ".svg": "svg",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".json": "code",
  ".js": "code",
  ".ts": "code",
  ".py": "code",
  ".tsx": "code",
  ".jsx": "code",
  ".css": "code",
};

function snapshot(r: AgentRecord): AgentMeta {
  const { listeners, abort, research, ...meta } = r;
  return meta;
}

function emit(id: string) {
  const r = agents.get(id);
  if (!r) return;
  const snap = snapshot(r);
  for (const fn of r.listeners) {
    try {
      fn(snap);
    } catch {
    }
  }
}

function patch(id: string, p: Partial<AgentMeta>) {
  const r = agents.get(id);
  if (!r) return;
  Object.assign(r, p, { updatedAt: Date.now() });
  emit(id);
}

function pushLog(id: string, entry: AgentLogEntry) {
  const r = agents.get(id);
  if (!r) return;
  r.log = [...r.log.slice(-400), entry];
  emit(id);
}

export function getAgents(): AgentMeta[] {
  return [...agents.values()].map(snapshot).sort((a, b) => b.createdAt - a.createdAt);
}

export function getAgent(id: string): AgentMeta | null {
  const r = agents.get(id);
  return r ? snapshot(r) : null;
}

export function subscribeAgent(id: string, fn: (a: AgentMeta) => void): () => void {
  const r = agents.get(id);
  if (!r) return () => {};
  r.listeners.add(fn);
  return () => r.listeners.delete(fn);
}

export interface SpawnAgentInput {
  task: string;
  provider: string;
  model: string;
  engine?: "tool-loop" | "agent-sdk";
  label?: string;
  image?: string;
  env?: Record<string, string>;
  conversationId?: string;
  research?: boolean;
}

export async function spawnAgent(input: SpawnAgentInput): Promise<AgentMeta> {
  const id = nanoid(10);
  const research = !!input.research || RESEARCH_RE.test(input.task || "");
  const record: AgentRecord = {
    id,
    label: input.label || input.task.slice(0, 60),
    task: input.task,
    provider: input.provider as any,
    model: input.model,
    engine: input.engine || "tool-loop",
    status: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: 0,
    log: [{ t: Date.now(), level: "info", message: "Agent queued" }],
    resultFiles: [],
    conversationId: input.conversationId,
    image: input.image || process.env.SANDBOX_IMAGE || "omnia-sandbox:latest",
    research,
    listeners: new Set(),
  };
  agents.set(id, record);
  emit(id);

  void runSandboxedAgent(id).catch((e) => {
    patch(id, { status: "failed", error: e.message });
    pushLog(id, { t: Date.now(), level: "error", message: e.message });
  });

  return snapshot(record);
}

async function runSandboxedAgent(id: string) {
  const r = agents.get(id)!;
  patch(id, { status: "starting" });
  pushLog(id, { t: Date.now(), level: "info", message: "Creating Docker sandbox…" });

  let sandboxId = "";
  try {
    const env: Record<string, string> = { ...(process.env as any) };

    if (isBuiltinProvider(r.provider)) {
      const keyEnv = PROVIDERS[r.provider as BuiltinProviderId]?.keyEnv;
      if (keyEnv) {
        const stored = await getStoredProviderKey(r.provider);
        if (stored) {
          env[keyEnv] = stored;
          if (r.provider === "google") env.GOOGLE_API_KEY = stored;
        }
      }
    }

    if (r.provider === "opencode") {
      env.OPENCODE_TRANSPORT = getOpencodeTransport(r.model);
    }

    if (!isBuiltinProvider(r.provider)) {
      const custom = await getCustomProvider(r.provider);
      if (custom) {
        env.OMNIA_CUSTOM_BASE_URL = custom.baseUrl;
        env.OMNIA_CUSTOM_PROTOCOL =
          custom.protocol === "anthropic" || custom.protocol === "gemini"
            ? custom.protocol
            : "openai";
        const key = resolveApiKey(custom);
        if (key) env.OMNIA_CUSTOM_API_KEY = key;
      }
    }

    if (r.research) env.AGENT_MODE = "research";

    const created = await createSandbox({
      image: r.image,
      label: `agent-${r.provider}-${r.id}`,
      env,
      runner: {
        task: r.task,
        provider: r.provider,
        model: r.model,
        engine: r.engine,
      },
    });

    sandboxId = created.id;
    patch(id, { sandboxId });
    pushLog(id, { t: Date.now(), level: "info", message: `Sandbox ${sandboxId} created` });

    await streamAgentEvents(id, sandboxId);

    if (agents.get(id)?.abort?.signal.aborted) return;

    await harvestResults(id, sandboxId);

    const rec = agents.get(id);
    if (rec && ["failed", "stopped"].includes(rec.status)) return;
    patch(id, { status: "done", progress: 100 });
    pushLog(id, { t: Date.now(), level: "done", message: "Agent finished" });
  } catch (e: any) {
    patch(id, { status: "failed", error: e.message });
    pushLog(id, { t: Date.now(), level: "error", message: e.message });
  } finally {
    if (sandboxId) {
      try {
        await deleteSandbox(sandboxId);
      } catch {
      }
    }
  }
}

async function streamAgentEvents(id: string, sandboxId: string) {
  const base = process.env.SANDBOX_URL || "http://127.0.0.1:8787";
  const url = `${base}/containers/${sandboxId}/events`;
  const ctrl = new AbortController();
  const r = agents.get(id)!;
  r.abort = ctrl;

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok || !res.body) {
      pushLog(id, { t: Date.now(), level: "error", message: `events: ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        try {
          const evt = JSON.parse(t.slice(5).trim());
          handleRunnerEvent(id, evt);
        } catch {
        }
      }
    }
  } catch (e: any) {
    if (e.name !== "AbortError") {
      pushLog(id, { t: Date.now(), level: "error", message: `stream: ${e.message}` });
    }
  }
}

function handleRunnerEvent(id: string, evt: any) {
  switch (evt.type) {
    case "log":
    case "thinking":
    case "text":
    case "tool":
    case "file":
    case "error":
    case "done":
      pushLog(id, {
        t: Date.now(),
        level: evt.type === "log" ? "info" : evt.type,
        message: evt.message || evt.name || "",
      });
      break;
    case "progress":
      patch(id, { progress: Math.min(100, Number(evt.value) || 0) });
      break;
    case "status":
      if (evt.value === "done") patch(id, { status: "running", progress: 100 });
      else if (evt.value === "error") patch(id, { status: "failed" });
      else patch(id, { status: "running" });
      break;
    case "artifact":
      break;
  }
}

async function harvestResults(id: string, sandboxId: string) {
  const r = agents.get(id)!;
  try {
    const files = await sandboxResultFiles(sandboxId, "/workspace/out");
    if (!files.length) {
      pushLog(id, { t: Date.now(), level: "info", message: "No result files produced." });
      return;
    }
    const artifacts = [];
    for (const f of files.slice(0, 25)) {
      try {
        const buf = await sandboxDownload(sandboxId, `/workspace/out/${f.path}`);
        const ext = (f.name.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
        const type = EXT_TO_TYPE[ext] || "text";
        const meta = await importArtifactFile({
          title: f.name,
          type,
          filename: f.name,
          data: buf,
          conversationId: r.conversationId,
        });
        artifacts.push(meta);
        pushLog(id, {
          t: Date.now(),
          level: "file",
          message: `Result: ${f.name} (${(buf.byteLength / 1024).toFixed(1)} KB)`,
        });
      } catch (e: any) {
        pushLog(id, { t: Date.now(), level: "error", message: `harvest ${f.name}: ${e.message}` });
      }
    }
    patch(id, { resultFiles: artifacts });
  } catch (e: any) {
    pushLog(id, { t: Date.now(), level: "error", message: `harvest: ${e.message}` });
  }
}

export async function stopAgent(id: string): Promise<void> {
  const r = agents.get(id);
  if (!r) return;
  r.abort?.abort();
  if (r.sandboxId) {
    try {
      await deleteSandbox(r.sandboxId);
    } catch {
    }
  }
  patch(id, { status: "stopped" });
  pushLog(id, { t: Date.now(), level: "info", message: "Agent stopped" });
}

export function cleanupFinishedAgents(maxAgeMs = 4 * 60 * 60 * 1000): number {
  let removed = 0;
  for (const [id, r] of agents) {
    if (["done", "failed", "stopped"].includes(r.status)) {
      if (Date.now() - r.updatedAt > maxAgeMs) {
        agents.delete(id);
        removed++;
      }
    }
  }
  return removed;
}
