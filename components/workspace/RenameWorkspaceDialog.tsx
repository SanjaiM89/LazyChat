"use client";

/**
 * Rename a workspace.
 *
 * A workspace is named after its folder by default, but the folder path and the
 * label are different things: `/home/sanjai/Projects/chess` reads better as
 * "Chess Backend" in a list. The folder is what the tools operate on and never
 * changes here — only the display name.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { dshApi } from "@/lib/dsh/client";
import type { Workspace } from "@/lib/dsh/types";

export function RenameWorkspaceDialog({
  workspace,
  onClose,
  onRenamed,
}: {
  workspace: Workspace;
  onClose: () => void;
  onRenamed: () => void | Promise<void>;
}) {
  const [name, setName] = React.useState(workspace.name);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    const next = name.trim();
    if (!next || next === workspace.name) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await dshApi.updateWorkspace(workspace.id, { name: next });
      // Any chat bound to this workspace carries a cached copy of the label, so
      // the rename has to reach those rows too.
      const store = await import("@/lib/app-store");
      for (const [cid, bound] of Object.entries(
        store.useAppStore.getState().conversationWorkspaces,
      )) {
        if (bound.id === workspace.id) {
          store.useAppStore
            .getState()
            .setConversationWorkspace(cid, { ...bound, name: next });
        }
      }
      await onRenamed();
      onClose();
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
        className="relative w-full max-w-sm overflow-hidden rounded-lg border border-border-strong bg-bg-overlay shadow-pop animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent" />
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-[15px] font-medium tracking-tight">Rename workspace</h2>
          <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
            {workspace.path}
          </p>
        </div>
        <div className="px-5 py-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") onClose();
            }}
            className="w-full rounded-md border border-border-strong bg-bg-control transition-[border-color,box-shadow] duration-200 hover:border-border-stronger px-2.5 py-2 text-[13px] focus:outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          {error && <p className="mt-2 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger animate-fade-in-up">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-bg-surface-100 px-5 py-3">
          <button
            onClick={onClose}
            className="h-8 rounded-md border border-border-strong bg-bg-control px-3 text-[13px] text-fg transition-colors hover:bg-bg-surface-300"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy || !name.trim()}
            className={"btn-sheen inline-flex items-center justify-center rounded-md border border-[color:var(--brand-button-border)] bg-[color:var(--brand-button)] text-[color:var(--brand-button-text)] font-medium transition-[filter,box-shadow] duration-200 hover:brightness-110 hover:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-45 disabled:pointer-events-none h-8 px-3 text-[13px]"}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}