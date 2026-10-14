/**
 * Native workspace tools: the DeepSeek-style capability set, ported into this
 * app's own agent loop instead of shelled out to the dsh binary.
 *
 * Every tool is confined to one workspace root (symlink/traversal escapes are
 * rejected), streams back through the normal chat tool pipeline, and records
 * durable workspace memory fire-and-forget. The chat UI is untouched — these
 * just appear as tools when a conversation has a workspace attached.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";

import { FalkorClient } from "@/lib/brain/graph";
import { addTodo, listTodos, setTodoStatus, storeShared, writeWorkspaceRecord } from "@/lib/dsh/memory";
import { getWorkspace } from "@/lib/dsh/workspaces";

/** Resolve `rel` inside `root`, rejecting escapes (.., absolute, symlinks out). */
export function resolveIn(root: string, rel: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, rel || ".");
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Path escapes the workspace: ${rel}`);
  }
  // Resolve symlinks and re-check: a link inside the root may point outside.
  let real = target;
  try {
    real = fs.realpathSync(target);
  } catch {
    // Missing path: check the nearest existing ancestor instead.
    let probe = target;
    for (;;) {
      probe = path.dirname(probe);
      try {
        const anchor = fs.realpathSync(probe);
        real = path.join(anchor, path.relative(probe, target));
        break;
      } catch {
        if (probe === base || probe === path.dirname(probe)) {
          real = target;
          break;
        }
      }
    }
  }
  if (real !== base && !real.startsWith(base + path.sep)) {
    throw new Error(`Path escapes the workspace: ${rel}`);
  }
  return target;
}

function truncate(text: string, max = 12000): string {
  if (text.length <= max) return text;
  return text.slice(0, 6000) + `\n… [${text.length - max} chars cut] …\n` + text.slice(-6000);
}

async function brain(): Promise<FalkorClient | null> {
  try {
    return await FalkorClient.get();
  } catch {
    return null;
  }
}

export interface WorkspaceToolCtx {
  workspaceId: string;
  root: string;
  sessionId?: string;
}

export function buildWorkspaceTools(ctx: WorkspaceToolCtx) {
  const { workspaceId, root } = ctx;

  const remember = (kind: "command" | "change" | "error", data: Record<string, unknown>) => {
    void (async () => {
      try {
        const c = await brain();
        if (c) await writeWorkspaceRecord(c, workspaceId, kind, data);
      } catch {
        // memory must never fail a tool call
      }
    })();
  };

  return {
    ws_list: tool({
      description: `List files in the attached workspace folder (relative paths, directories first). Use to explore the project before reading or editing. Confined to the workspace root.`,
      inputSchema: z.object({ path: z.string().default("").describe("Workspace-relative directory, '' for root") }),
      execute: async ({ path: rel }) => {
        const target = resolveIn(root, rel);
        const names = fs.readdirSync(target);
        const out: Array<{ name: string; dir: boolean; size?: number }> = [];
        for (const name of names.slice(0, 300)) {
          if (name === ".git" || name === "node_modules") continue;
          try {
            const st = fs.statSync(path.join(target, name));
            out.push({ name, dir: st.isDirectory(), size: st.isDirectory() ? undefined : st.size });
          } catch {
            // skip unreadable
          }
        }
        out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
        return { path: rel || ".", entries: out };
      },
    }),

    ws_read: tool({
      description: `Read a file in the attached workspace (workspace-relative path). Returns text up to ~20k chars. Confined to the workspace root.`,
      inputSchema: z.object({ path: z.string().describe("Workspace-relative file path") }),
      execute: async ({ path: rel }) => {
        const target = resolveIn(root, rel);
        const st = fs.statSync(target);
        if (!st.isFile()) throw new Error(`Not a file: ${rel}`);
        if (st.size > 2_000_000) throw new Error(`File too large (${st.size} bytes): ${rel}`);
        return { path: rel, size: st.size, content: fs.readFileSync(target, "utf8").slice(0, 20000) };
      },
    }),

    ws_write: tool({
      description: `Write (create or overwrite) a file in the attached workspace. Parent directories are created. Confined to the workspace root. Prefer editing via shell for partial changes.`,
      inputSchema: z.object({
        path: z.string().describe("Workspace-relative file path"),
        content: z.string().describe("Full file content"),
      }),
      execute: async ({ path: rel, content }) => {
        const target = resolveIn(root, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, "utf8");
        remember("change", { files: [rel], summary: `Wrote ${rel} (${content.length} chars)` });
        return { path: rel, bytes: content.length };
      },
    }),

    ws_shell: tool({
      description: `Run a shell command with the workspace folder as cwd (bash, 120s timeout). Use for builds, tests, git, scripts — anything the task needs executed. Output truncated to ~12k chars. The command and outcome are remembered in workspace memory.`,
      inputSchema: z.object({
        command: z.string().describe("Bash command, e.g. 'npm test' or 'git status --short'"),
        timeout_s: z.number().min(5).max(600).default(120).describe("Timeout in seconds"),
      }),
      execute: async ({ command, timeout_s }) => {
        const started = Date.now();
        const result = await new Promise<{ code: number; out: string }>((resolve) => {
          execFile(
            "bash",
            ["-lc", command],
            { cwd: root, timeout: (timeout_s || 120) * 1000, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout, stderr) => {
              const out = (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
              resolve({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code as number) : 1) : 0, out });
            },
          );
        });
        const out = truncate(result.out);
        remember("command", {
          command: command.slice(0, 2000),
          output: out.slice(0, 8000),
          exit_code: result.code,
          duration_ms: Date.now() - started,
        });
        return { exit_code: result.code, duration_ms: Date.now() - started, output: out };
      },
    }),

    ws_todo: tool({
      description: `Workspace TODO list: add/list/set. Use for multi-step tasks so progress survives across turns.`,
      inputSchema: z.object({
        op: z.enum(["add", "list", "done", "doing"]).describe("add|list|done|doing"),
        text: z.string().optional().describe("TODO text (for add)"),
        id: z.string().optional().describe("TODO id (for done/doing)"),
      }),
      execute: async ({ op, text, id }) => {
        const c = await brain();
        if (!c) throw new Error("Workspace memory is unavailable (FalkorDB down).");
        if (op === "add") {
          if (!text?.trim()) throw new Error("TODO text is required.");
          return { todo: await addTodo(c, workspaceId, text) };
        }
        if (op === "done" || op === "doing") {
          if (!id) throw new Error("TODO id is required.");
          await setTodoStatus(c, id, op);
          return { id, status: op };
        }
        return { todos: await listTodos(c, workspaceId) };
      },
    }),

    ws_remember: tool({
      description: `Store durable workspace memory: decisions, plans, error fixes, preferences, summaries. Scoped to this workspace (use scope 'global' for cross-workspace knowledge). Secrets are redacted; duplicates merge; same-slot facts replace.`,
      inputSchema: z.object({
        kind: z.enum(["plan", "decision", "error", "preference", "summary", "note"]).describe("What kind of memory"),
        text: z.string().describe("The content (for error: 'error ||| fix')"),
        slot: z.string().optional().describe("Single-value slot, e.g. user.name"),
        scope: z.enum(["workspace", "global"]).default("workspace"),
      }),
      execute: async ({ kind, text, slot, scope }) => {
        const c = await brain();
        if (!c) throw new Error("Workspace memory is unavailable (FalkorDB down).");
        if (kind === "error") {
          const [error, fix] = text.split("|||").map((s) => s.trim());
          const id = await writeWorkspaceRecord(c, workspaceId, "error", { error: error ?? text, fix: fix ?? "" });
          return { id };
        }
        if (kind === "plan" || kind === "decision" || kind === "summary") {
          const title = text.split("\n")[0].slice(0, 120);
          const id = await writeWorkspaceRecord(
            c,
            workspaceId,
            kind,
            kind === "summary" ? { summary: text } : { title, body: text },
          );
          return { id };
        }
        const mem = await storeShared(
          c,
          scope === "global"
            ? { scope: "global", kind: kind === "preference" ? "preference" : "note", text, slot }
            : { scope: `workspace:${workspaceId}`, kind: kind === "preference" ? "preference" : "note", text, slot },
        );
        return { id: mem.id };
      },
    }),
  };
}

/** Load workspace context (memory briefing) for prompt injection. */
export async function workspaceBriefing(workspaceId: string, maxChars = 4000): Promise<{ briefing: string; root: string; name: string } | null> {
  const c = await brain();
  if (!c) return null;
  const ws = await getWorkspace(c, workspaceId);
  if (!ws) return null;
  const { buildMemoryContext } = await import("@/lib/dsh/memory");
  const ctx = await buildMemoryContext(c, workspaceId, maxChars);
  const head =
    `## Active workspace: ${ws.name}\nWorking directory for all file/shell tools: ${ws.path}\n` +
    (ws.description ? `About: ${ws.description}\n` : "");
  return { briefing: ctx ? `${head}\n${ctx}` : head, root: ws.path, name: ws.name };
}
