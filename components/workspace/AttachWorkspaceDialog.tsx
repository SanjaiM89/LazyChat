"use client";

/**
 * New-workspace flow, launched from the sidebar + menu.
 *
 * A workspace is a folder on this machine, the way the harness treats one: you
 * name a path, or walk to one, and the chat is bound to it. The title defaults
 * to the folder's own name and stays editable; the folder is what the tools
 * operate on.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/lib/app-store";
import { workspaceApi } from "@/lib/workspace/client";
import type { ChatController } from "@/lib/use-chat";
import type { Workspace } from "@/lib/workspace/types";
import { Folder, FolderOpen, CornerLeftUp, Briefcase, AlertTriangle } from "lucide-react";

export function AttachWorkspaceDialog({ chat, onClose }: { chat: ChatController; onClose: () => void }) {
  const [existing, setExisting] = React.useState<Workspace[]>([]);
  const [title, setTitle] = React.useState("");
  const [path, setPath] = React.useState("");
  const [cwd, setCwd] = React.useState("");
  const [parent, setParent] = React.useState<string | null>(null);
  const [dirs, setDirs] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Once the user types their own title the folder default stops overwriting it,
  // so picking another folder cannot discard what they chose.
  const [titleTouched, setTitleTouched] = React.useState(false);

  React.useEffect(() => {
    void workspaceApi.workspaces().then((r) => setExisting(r.workspaces)).catch(() => {});
    void browse("").then((d) => {
      setCwd(d.cwd);
      setParent(d.parent);
      setDirs(d.dirs);
    }).catch(() => {});
  }, []);

  async function browse(dir: string) {
    const res = await fetch(`/api/workspace/browse?path=${encodeURIComponent(dir)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { cwd: string; parent: string | null; dirs: string[] };
  }

  async function nav(dir: string) {
    try {
      const d = await browse(dir);
      setCwd(d.cwd);
      setParent(d.parent);
      setDirs(d.dirs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function attach(ws: { id: string; name: string; path: string }) {
    chat.startNew();
    const cid = crypto.randomUUID();
    useAppStore.getState().setActiveConversation(cid);
    useAppStore.getState().setConversationWorkspace(cid, ws);
    onClose();
  }

  /**
   * Point the dialog at a folder. The title follows the folder's own basename
   * unless the user already named the workspace themselves — a project folder
   * is what the workspace is, and the title stays editable either way.
   */
  function pickFolder(next: string) {
    setPath(next);
    if (titleTouched) return;
    const base = next.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
    setTitle(base);
  }

  async function create() {
    const target = path.trim();
    if (!target) {
      setError("Enter the path of a folder to use as a workspace.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await workspaceApi.createWorkspace({ path: target, title: title.trim() || undefined });
      await attach({ id: r.workspace.id, name: r.workspace.title, path: r.workspace.path });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Portal to document.body: the sidebar's transform would otherwise trap
  // `fixed` positioning and squeeze the dialog into the sidebar column.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[6px] [animation:overlay-in_0.3s_ease_both]" onClick={onClose}>
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-lg border border-border-strong bg-bg-overlay shadow-pop animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent" />
        <div className="flex items-start gap-3 border-b border-border px-5 py-3.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-surface-200 text-accent">
            <Briefcase size={15} />
          </span>
          <div>
          <h2 className="text-[15px] font-medium tracking-tight">New workspace</h2>
          <p className="mt-0.5 text-[12px] text-fg-muted">
            Bind a fresh chat to a folder on this machine. File and shell tools will run there.
          </p>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {existing.length > 0 && (
            <div className="mb-3">
              <p className="eyebrow pb-1.5">
                Attach existing
              </p>
              {existing.map((w) => (
                <button
                  key={w.id}
                  onClick={() => void attach({ id: w.id, name: w.title, path: w.path })}
                  className="group mb-1 flex w-full items-center gap-2.5 truncate rounded-md border border-border bg-bg-surface-100 px-3 py-2 text-left text-[13px] transition-colors hover:border-brand/40 hover:bg-bg-hover"
                >
                  <Folder size={14} className="shrink-0 text-fg-muted transition-colors group-hover:text-accent" />
                  <span className="truncate">{w.title}</span>
                  <span className="truncate font-mono text-[11px] text-fg-muted">{w.path}</span>
                  {w.dir_status === "missing-dir" && (
                    <span
                      title="The folder is gone. The workspace is kept so its history stays reachable."
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn"
                    >
                      <AlertTriangle size={10} /> missing
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <p className="eyebrow pb-1.5">
            Add a folder
          </p>
          <input
            value={path}
            onChange={(e) => pickFolder(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            placeholder="/home/you/projects/my-app"
            className="mb-2 w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-2 font-mono text-[12px] focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
            }}
            placeholder="Title (defaults to the folder name)"
            className="mb-2 w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-2 text-[13px] focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <div className="mb-2 flex gap-2">
            <button
              onClick={() => void create()}
              disabled={busy || !path.trim()}
              className={"btn-sheen inline-flex items-center justify-center rounded-md border border-[color:var(--brand-button-border)] bg-[color:var(--brand-button)] text-[color:var(--brand-button-text)] font-medium transition-[filter,box-shadow] duration-200 hover:brightness-110 hover:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-45 disabled:pointer-events-none h-8 px-4 text-[13px]"}
            >
              {busy ? "Adding…" : "Add workspace"}
            </button>
          </div>
          <p className="flex items-center gap-1.5 pb-1.5 font-mono text-[11px] text-fg-muted"><FolderOpen size={12} className="text-accent" />{cwd || "…"}</p>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-bg-surface-100">
            {dirs.map((d) => (
              <button
                key={d}
                onClick={() => {
                  pickFolder(`${cwd}/${d}`);
                  void nav(`${cwd}/${d}`);
                }}
                className="group flex w-full items-center gap-2 truncate border-b border-border-muted px-3 py-1.5 text-left font-mono text-[12px] text-fg-secondary transition-colors last:border-b-0 hover:bg-bg-hover hover:text-fg"
              >
                <Folder size={13} className="shrink-0 text-fg-muted transition-colors group-hover:text-accent" />
                {d}
              </button>
            ))}
            {dirs.length === 0 && <p className="px-3 py-2 text-[12px] text-fg-muted">No subfolders.</p>}
          </div>
          {parent && (
            <button onClick={() => void nav(parent)} className="mt-1.5 inline-flex items-center gap-1 rounded px-1 text-[12px] text-brand-link transition-colors hover:bg-bg-hover">
              <CornerLeftUp size={12} /> parent folder
            </button>
          )}
          {error && <p className="mt-2 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger animate-fade-in-up">{error}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
