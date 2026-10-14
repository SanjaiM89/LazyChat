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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[14px] font-semibold">Rename workspace</h2>
          <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
            {workspace.path}
          </p>
        </div>
        <div className="px-4 py-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") onClose();
            }}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] text-fg-secondary hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy || !name.trim()}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}