"use client";

/**
 * Workspace view: harness-like environment wrapped around (not inside) chat.
 *
 * Layout: workspaces + sessions | agent execution (task, tool timeline,
 * output) | files / memory / todos / history tabs. ChatView/Composer are
 * untouched — this is a separate mainView.
 */
import * as React from "react";
import { useAppStore } from "@/lib/app-store";
import { dshApi, type FileEntry } from "@/lib/dsh/client";
import type { AgentRun, AgentSession, CommandRun, MemoryRecord, TodoItem, Workspace } from "@/lib/dsh/types";

type RightTab = "files" | "memory" | "todos" | "history";

export function WorkspaceView() {
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [sessions, setSessions] = React.useState<AgentSession[]>([]);
  const [todos, setTodos] = React.useState<TodoItem[]>([]);
  const [memoryPreview, setMemoryPreview] = React.useState("");
  const [task, setTask] = React.useState("");
  const [run, setRun] = React.useState<AgentRun | null>(null);
  const [output, setOutput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<RightTab>("files");
  const [files, setFiles] = React.useState<FileEntry[]>([]);
  const [dir, setDir] = React.useState("");
  const [memories, setMemories] = React.useState<MemoryRecord[]>([]);
  const [commands, setCommands] = React.useState<CommandRun[]>([]);
  const [newName, setNewName] = React.useState("");
  const [newPath, setNewPath] = React.useState("");
  const [status, setStatus] = React.useState<{ dsh: { built: boolean; version: string | null }; falkordb: { reachable: boolean } } | null>(null);
  const outRef = React.useRef<HTMLDivElement>(null);
  const pollRef = React.useRef<number | null>(null);

  const active = workspaces.find((w) => w.id === activeId) ?? null;

  const refreshList = React.useCallback(async () => {
    try {
      const r = await dshApi.workspaces();
      setWorkspaces(r.workspaces);
      if (!activeId && r.workspaces.length > 0) setActiveId(r.workspaces[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeId]);

  const refreshActive = React.useCallback(
    async (id: string) => {
      try {
        const [w, f, m, c] = await Promise.all([
          dshApi.workspace(id),
          dshApi.files(id, dir),
          dshApi.memory(id, ""),
          dshApi.commands(id),
        ]);
        setSessions(w.sessions);
        setTodos(w.todos);
        setMemoryPreview(w.memory_preview);
        setFiles(f.entries ?? []);
        setMemories(m.memories);
        setCommands(c.commands);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [dir],
  );

  React.useEffect(() => {
    void refreshList();
    void dshApi.status().then(setStatus).catch(() => {});
  }, [refreshList]);

  React.useEffect(() => {
    if (activeId) void refreshActive(activeId);
  }, [activeId, refreshActive]);

  React.useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
  }, [output]);

  React.useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  async function create() {
    if (!newPath.trim()) return;
    setError(null);
    try {
      const r = await dshApi.createWorkspace({ name: newName.trim(), path: newPath.trim() });
      setNewName("");
      setNewPath("");
      await refreshList();
      setActiveId(r.workspace.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function startRun() {
    if (!active || !task.trim() || busy) return;
    setError(null);
    setBusy(true);
    setOutput("");
    try {
      const r = await dshApi.startRun(active.id, task.trim());
      setRun(r.run);
      setTask("");
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const s = await dshApi.run(r.run.id);
          setRun(s.run);
          setOutput(s.output);
          if (s.run.status === "done" || s.run.status === "failed" || s.run.status === "stopped") {
            if (pollRef.current) window.clearInterval(pollRef.current);
            setBusy(false);
            void refreshActive(active.id);
          }
        } catch (e) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setBusy(false);
          setError(e instanceof Error ? e.message : String(e));
        }
      }, 1000);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function stopRun() {
    if (!run) return;
    try {
      await dshApi.stopRun(run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Tool-call timeline parsed from JSONL run output (best-effort). */
  const timeline = React.useMemo(() => {
    const items: string[] = [];
    for (const line of output.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        const ev = JSON.parse(t) as Record<string, unknown>;
        const type = typeof ev.type === "string" ? ev.type : "";
        if (/tool|session|turn|step|error/i.test(type)) {
          const name =
            (ev.name as string) || (ev.tool as string) || (ev.event as string) || type;
          items.push(`${type}: ${String(name).slice(0, 120)}`);
        }
      } catch {
        // non-JSON line — shown in raw output only
      }
    }
    return items.slice(-60);
  }, [output]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-fg">
      {/* workspaces + sessions */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-subtle">
        <div className="border-b border-border p-3">
          <h2 className="text-sm font-semibold">Workspaces</h2>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            {status
              ? `dsh ${status.dsh.built ? `ready (${status.dsh.version ?? "built"})` : "not built yet"} · FalkorDB ${status.falkordb.reachable ? "connected" : "down"}`
              : "checking sandbox…"}
          </p>
          <div className="mt-2 space-y-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (optional)"
              className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              placeholder="/absolute/path/to/project"
              className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
            <button
              onClick={() => void create()}
              className="w-full rounded-lg bg-accent px-2 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              Create workspace
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => setActiveId(w.id)}
              className={`mb-1 block w-full rounded-lg px-3 py-2 text-left ${
                w.id === activeId ? "bg-accent-soft/70" : "hover:bg-bg-hover"
              }`}
            >
              <p className="truncate text-[13px] font-medium">{w.name}</p>
              <p className="truncate font-mono text-[10.5px] text-fg-muted">{w.path}</p>
            </button>
          ))}
          {workspaces.length === 0 && (
            <p className="px-2 pt-3 text-[11px] text-fg-muted">No workspaces yet — create one above.</p>
          )}
          {sessions.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                Agent sessions
              </p>
              {sessions.map((s) => (
                <div key={s.id} className="rounded-lg px-3 py-1.5">
                  <p className="truncate font-mono text-[11px]">{s.id.slice(0, 24)}</p>
                  <p className="truncate text-[10.5px] text-fg-muted">
                    {s.status} · {(s.goal ?? "").slice(0, 60)}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      </aside>

      {/* agent execution */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{active ? active.name : "No workspace selected"}</h2>
            {run && (
              <span className="rounded-full bg-bg-elevated px-2.5 py-0.5 text-[11px] text-fg-secondary">
                {run.status}
                {run.exit_code !== undefined ? ` (${run.exit_code})` : ""}
              </span>
            )}
          </div>
          {active && <p className="mt-0.5 font-mono text-[10.5px] text-fg-muted">{active.path}</p>}
          {memoryPreview && (
            <details className="mt-2 rounded-lg border border-border bg-bg-elevated p-2">
              <summary className="cursor-pointer text-[11px] text-fg-secondary">
                Memory injected into agents ({memoryPreview.length} chars)
              </summary>
              <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] text-fg-muted">
                {memoryPreview}
              </pre>
            </details>
          )}
          <div className="mt-2 flex gap-2">
            <input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void startRun()}
              placeholder={active ? "Describe the task for the agent…" : "Select a workspace first"}
              disabled={!active || busy}
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent disabled:opacity-50"
            />
            {busy ? (
              <button onClick={() => void stopRun()} className="rounded-lg bg-danger px-4 py-2 text-[13px] font-medium text-white">
                Stop
              </button>
            ) : (
              <button
                onClick={() => void startRun()}
                disabled={!active || !task.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Run agent
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        </div>
        {timeline.length > 0 && (
          <div className="max-h-32 overflow-y-auto border-b border-border bg-bg-subtle px-3 py-2">
            <p className="pb-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted">Tool timeline</p>
            {timeline.map((t, i) => (
              <p key={i} className="font-mono text-[11px] text-fg-secondary">
                {t}
              </p>
            ))}
          </div>
        )}
        <div ref={outRef} className="flex-1 overflow-y-auto bg-black/40 p-3">
          {output ? (
            <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-fg-secondary">{output}</pre>
          ) : (
            <p className="text-[12px] text-fg-muted">
              Agent output streams here. Runs execute `dsh headless` with this workspace as cwd and
              workspace + shared memory mounted as MCP tools.
            </p>
          )}
        </div>
      </section>

      {/* files / memory / todos / history */}
      <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-bg-subtle">
        <div className="flex border-b border-border">
          {(["files", "memory", "todos", "history"] as RightTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-2 py-2 text-[12px] capitalize ${
                tab === t ? "border-b-2 border-accent font-medium text-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "files" && <FilesPanel workspaceId={active?.id} files={files} dir={dir} setDir={setDir} setFiles={setFiles} />}
          {tab === "memory" && <MemoryPanel workspaceId={active?.id} memories={memories} setMemories={setMemories} />}
          {tab === "todos" && <TodosPanel todos={todos} />}
          {tab === "history" && <HistoryPanel commands={commands} />}
        </div>
      </aside>
    </div>
  );
}

function FilesPanel({
  workspaceId,
  files,
  dir,
  setDir,
  setFiles,
}: {
  workspaceId?: string;
  files: FileEntry[];
  dir: string;
  setDir: (d: string) => void;
  setFiles: (f: FileEntry[]) => void;
}) {
  const [preview, setPreview] = React.useState<string | null>(null);
  if (!workspaceId) return <p className="text-[12px] text-fg-muted">Select a workspace.</p>;
  return (
    <div>
      {dir && (
        <button onClick={() => setDir(dir.split("/").slice(0, -1).join("/"))} className="mb-1 text-[11px] text-accent">
          ↑ up
        </button>
      )}
      {files.map((f) => (
        <button
          key={f.path}
          onClick={async () => {
            if (f.dir) {
              setDir(f.path);
              const r = await dshApi.files(workspaceId, f.path);
              setFiles(r.entries ?? []);
            } else {
              const r = await dshApi.files(workspaceId, f.path);
              setPreview(r.content ?? "");
            }
          }}
          className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[12px] hover:bg-bg-hover"
        >
          {f.dir ? "📁" : "📄"} {f.name}
        </button>
      ))}
      {preview !== null && (
        <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg p-2 text-[11px]">
          {preview}
        </pre>
      )}
    </div>
  );
}

function MemoryPanel({
  workspaceId,
  memories,
  setMemories,
}: {
  workspaceId?: string;
  memories: MemoryRecord[];
  setMemories: (m: MemoryRecord[]) => void;
}) {
  const [q, setQ] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  async function refresh() {
    if (!workspaceId) return;
    const r = await dshApi.memory(workspaceId, q);
    setMemories(r.memories);
  }
  async function save() {
    if (!draft.trim()) return;
    await dshApi.storeMemory({ scope: workspaceId ? `workspace:${workspaceId}` : "global", kind: "note", text: draft.trim() });
    setDraft("");
    await refresh();
  }
  async function remove(id: string) {
    await dshApi.deleteMemory(id);
    await refresh();
  }
  async function saveEdit(id: string) {
    await dshApi.updateMemory(id, { text: editText });
    setEditing(null);
    await refresh();
  }
  return (
    <div>
      <div className="mb-2 flex gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void refresh()}
          placeholder="Search memory…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        <button onClick={() => void refresh()} className="rounded-lg border border-border px-2 text-xs">
          Go
        </button>
      </div>
      <div className="mb-3 flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          placeholder="Store a memory…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        <button onClick={() => void save()} className="rounded-lg bg-accent px-2 text-xs text-white">
          Save
        </button>
      </div>
      {memories.map((m) => (
        <div key={m.id} className="mb-1.5 rounded-lg border border-border bg-bg p-2">
          <p className="text-[10px] text-fg-muted">
            {m.scope} · {m.kind}
            {m.slot ? ` · slot:${m.slot}` : ""} · used {m.use_count}×
          </p>
          {editing === m.id ? (
            <div className="mt-1 flex gap-1">
              <input
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="min-w-0 flex-1 rounded border border-border bg-bg-subtle px-1.5 py-1 text-xs"
              />
              <button onClick={() => void saveEdit(m.id)} className="text-xs text-accent">
                Save
              </button>
            </div>
          ) : (
            <p className="mt-0.5 text-[12px]">{m.text}</p>
          )}
          <div className="mt-1 flex gap-2">
            <button
              onClick={() => {
                setEditing(m.id);
                setEditText(m.text);
              }}
              className="text-[11px] text-fg-muted hover:text-fg"
            >
              Edit
            </button>
            <button onClick={() => void remove(m.id)} className="text-[11px] text-danger">
              Delete
            </button>
          </div>
        </div>
      ))}
      {memories.length === 0 && <p className="text-[11px] text-fg-muted">No memories for this scope yet.</p>}
    </div>
  );
}

function TodosPanel({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return <p className="text-[11px] text-fg-muted">No TODOs — agents add them as they work.</p>;
  return (
    <div>
      {todos.map((t) => (
        <p key={t.id} className="mb-1 text-[12px]">
          <span className="mr-1.5">{t.status === "done" ? "✅" : t.status === "doing" ? "🔄" : "⬜"}</span>
          {t.text}
        </p>
      ))}
    </div>
  );
}

function HistoryPanel({ commands }: { commands: CommandRun[] }) {
  if (commands.length === 0) return <p className="text-[11px] text-fg-muted">No commands logged yet.</p>;
  return (
    <div>
      {commands.map((c) => (
        <details key={c.id} className="mb-1.5 rounded-lg border border-border bg-bg p-2">
          <summary className="cursor-pointer font-mono text-[11px]">
            ${c.command.slice(0, 80)} <span className="text-fg-muted">→ {c.exit_code}</span>
          </summary>
          <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[10.5px] text-fg-muted">
            {(c.output ?? "").slice(0, 3000)}
          </pre>
        </details>
      ))}
    </div>
  );
}
