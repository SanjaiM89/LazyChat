"use client";

/** Typed client for the workspace API (workspaces, files, memory). */
import type { AgentSession, CommandRun, MemoryRecord, TodoItem, Workspace } from "@/lib/workspace/types";

const BASE = "/api/workspace";

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

export const workspaceApi = {
  workspaces: () => json<{ workspaces: Workspace[] }>("/workspaces"),
  /**
   * Register a workspace for a folder. The path must be absolute and name an
   * existing directory; the title defaults to the folder's own name.
   */
  createWorkspace: (input: { path: string; title?: string; description?: string; tags?: string[] }) =>
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
  /** Remove the registration. The folder and its files stay where they are. */
  deleteWorkspace: (id: string) =>
    json<{ deleted: boolean }>(`/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" }),
  files: (id: string, dir = "") =>
    json<{ path: string; entries?: FileEntry[]; file?: FileEntry; content?: string }>(
      `/workspaces/${encodeURIComponent(id)}/files?path=${encodeURIComponent(dir)}`,
    ),
  commands: (id: string) => json<{ commands: CommandRun[] }>(`/workspaces/${encodeURIComponent(id)}/commands`),

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
