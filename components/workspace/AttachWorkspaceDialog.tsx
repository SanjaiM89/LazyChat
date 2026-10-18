"use client";

/**
 * New-workspace flow, launched from the sidebar + menu.
 *
 * Attach an existing workspace to a fresh chat, or create one: name it, pick
 * a folder by browsing the server filesystem (confined to your own workspace area) or
 * typing an absolute path, and the new chat is bound to that folder — file
 * and shell tools then run there, memory scopes to it.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/lib/app-store";
import { dshApi } from "@/lib/dsh/client";
import type { ChatController } from "@/lib/use-chat";
import type { Workspace } from "@/lib/dsh/types";

export function AttachWorkspaceDialog({ chat, onClose }: { chat: ChatController; onClose: () => void }) {
  const [existing, setExisting] = React.useState<Workspace[]>([]);
  const [name, setName] = React.useState("");
  const [path, setPath] = React.useState("");
  const [cwd, setCwd] = React.useState("");
  const [dirs, setDirs] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Once the user types their own name the folder default stops overwriting it,
  // so picking another folder cannot discard what they chose.
  const [nameTouched, setNameTouched] = React.useState(false);

  React.useEffect(() => {
    void dshApi.workspaces().then((r) => setExisting(r.workspaces)).catch(() => {});
    void browse("").then((d) => {
      setCwd(d.cwd);
      setDirs(d.dirs);
    }).catch(() => {});
  }, []);

  async function browse(dir: string) {
    const res = await fetch(`/api/dsh/browse?path=${encodeURIComponent(dir)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { cwd: string; parent: string | null; dirs: string[] };
  }

  async function nav(dir: string) {
    try {
      const d = await browse(dir);
      setCwd(d.cwd);
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
   * Point the dialog at a folder. The name follows the folder's own basename
   * unless the user already named the workspace themselves — a project folder
   * is what the workspace is, and the name stays editable either way.
   */
  function pickFolder(next: string) {
    setPath(next);
    if (nameTouched) return;
    const base = next.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
    setName(base);
  }

  async function create() {
    const target = path.trim();
    if (!target && !name.trim()) {
      setError("Enter a name to create a new folder, or pick an existing one below.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // An empty name falls through to the folder basename server-side too, so
      // the default holds even if this dialog is bypassed.
      const r = await dshApi.createWorkspace({ name: name.trim(), path: target });
      await attach({ id: r.workspace.id, name: r.workspace.name, path: r.workspace.path });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Portal to document.body: the sidebar's transform would otherwise trap
  // `fixed` positioning and squeeze the dialog into the sidebar column.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[14px] font-semibold">New workspace</h2>
          <p className="mt-0.5 text-[12px] text-fg-muted">
            Bind a fresh chat to a project folder. File and shell tools will run there.
          </p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {existing.length > 0 && (
            <div className="mb-3">
              <p className="pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                Attach existing
              </p>
              {existing.map((w) => (
                <button
                  key={w.id}
                  onClick={() => void attach({ id: w.id, name: w.name, path: w.path })}
                  className="mb-1 block w-full truncate rounded-lg px-3 py-2 text-left text-[13px] hover:bg-bg-hover"
                >
                  {w.name} <span className="font-mono text-[11px] text-fg-muted">{w.path}</span>
                </button>
              ))}
            </div>
          )}
          <p className="pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
            Or create new
          </p>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            placeholder="Name (defaults to folder name)"
            className="mb-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          <div className="mb-2 flex gap-2">
            <input
              value={path}
              onChange={(e) => pickFolder(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              placeholder="Folder (optional - leave empty to create one from the name)"
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[12px] outline-none focus:border-accent"
            />
            <button
              onClick={() => void create()}
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
          <p className="pb-1 font-mono text-[11px] text-fg-muted">{cwd || "…"}</p>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
            {dirs.map((d) => (
              <button
                key={d}
                onClick={() => {
                  pickFolder(`${cwd}/${d}`);
                  void nav(`${cwd}/${d}`);
                }}
                className="block w-full truncate px-3 py-1.5 text-left font-mono text-[12px] hover:bg-bg-hover"
              >
                📁 {d}
              </button>
            ))}
            {dirs.length === 0 && <p className="px-3 py-2 text-[12px] text-fg-muted">No subfolders.</p>}
          </div>
          <button onClick={() => void nav(`${cwd}/..`)} className="mt-1 text-[12px] text-accent">
            ↑ parent folder
          </button>
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
