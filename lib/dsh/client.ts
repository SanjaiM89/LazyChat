"use client";

/** Typed client for the harness-bridge API (workspaces, runs, memory). */
import type { AgentRun, AgentSession, CommandRun, MemoryRecord, TodoItem, Workspace } from "@/lib/dsh/types";

const BASE = "/api/dsh";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export type FileEntry = {
  name: string;
  path: string;
  dir: boolean;
  size?: number;
  modified?: string;
};

export const dshApi = {
  status: () =>
    json<{ dsh: { built: boolean; version: string | null }; falkordb: { reachable: boolean; error?: string }; node: string }>(
      "/status",
    ),

  workspaces: () => json<{ workspaces: Workspace[] }>("/workspaces"),
  createWorkspace: (input: { name: string; path: string; description?: string; tags?: string[] }) =>
    json<{ workspace: Workspace }>("/workspaces", { method: "POST", body: JSON.stringify(input) }),
  workspace: (id: string) =>
    json<{ workspace: Workspace; sessions: AgentSession[]; todos: TodoItem[]; memory_preview: string }>(
      `/workspaces/${encodeURIComponent(id)}`,
    ),
  updateWorkspace: (id: string, patch: Record<string, unknown>) =>
    json<{ workspace: Workspace }>(`/workspaces/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  files: (id: string, dir = "") =>
    json<{ path: string; entries?: FileEntry[]; file?: FileEntry; content?: string }>(
      `/workspaces/${encodeURIComponent(id)}/files?path=${encodeURIComponent(dir)}`,
    ),
  commands: (id: string) => json<{ commands: CommandRun[] }>(`/workspaces/${encodeURIComponent(id)}/commands`),

  startRun: (workspace_id: string, task: string, session_id?: string) =>
    json<{ run: AgentRun }>("/runs", { method: "POST", body: JSON.stringify({ workspace_id, task, session_id }) }),
  run: (id: string) => json<{ run: AgentRun; output: string; truncated: boolean }>(`/runs/${encodeURIComponent(id)}`),
  stopRun: (id: string) => json<{ stopped: boolean }>(`/runs/${encodeURIComponent(id)}`, { method: "DELETE" }),

  memory: (workspace_id = "", q = "", limit = 20) =>
    json<{ memories: MemoryRecord[] }>(
      `/memory?workspace_id=${encodeURIComponent(workspace_id)}&q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  storeMemory: (input: { scope: string; kind: string; text: string; slot?: string | null; tags?: string[] }) =>
    json<{ memory: MemoryRecord }>("/memory", { method: "POST", body: JSON.stringify(input) }),
  updateMemory: (id: string, patch: { text?: string; tags?: string[] }) =>
    json<{ memory: MemoryRecord }>(`/memory/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteMemory: (id: string) => json<{ deleted: boolean }>(`/memory/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
