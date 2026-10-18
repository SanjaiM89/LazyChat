"use client";

/**
 * File explorer for the attached workspace folder.
 *
 * Shown in the right panel when the active conversation has a workspace
 * attached. Browse directories, preview text files. Writes happen through the
 * chat (ws_write tool), never here — this panel is read-only by design.
 */
import * as React from "react";
import { useAppStore } from "@/lib/app-store";
import { dshApi, type FileEntry } from "@/lib/dsh/client";
import { Folder, FolderOpen, CornerLeftUp, X } from "lucide-react";
import { FileIcon } from "@/components/brand/FileIcon";

export function FileExplorer() {
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const attached = useAppStore((s) =>
    activeConversationId ? s.conversationWorkspaces[activeConversationId] : undefined,
  );
  const [dir, setDir] = React.useState("");
  const [files, setFiles] = React.useState<FileEntry[]>([]);
  const [preview, setPreview] = React.useState<{ name: string; content: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (d: string) => {
      if (!attached) return;
      try {
        setError(null);
        const r = await dshApi.files(attached.id, d);
        setFiles(r.entries ?? []);
        setDir(d);
        setPreview(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [attached],
  );

  React.useEffect(() => {
    setDir("");
    setPreview(null);
    if (attached) void load("");
  }, [attached, load]);

  if (!attached) return <p className="m-4 rounded-lg border border-dashed border-border p-4 text-center text-[12px] text-fg-muted">No workspace attached to this chat.</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-bg-surface-200 text-accent">
          <FolderOpen size={14} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium">Workspace files</h2>
          <p className="truncate font-mono text-[10.5px] text-fg-muted">{attached.path}{dir ? `/${dir}` : ""}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {dir && (
          <button onClick={() => void load(dir.split("/").slice(0, -1).join("/"))} className="mb-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-brand-link transition-colors hover:bg-bg-hover">
            <CornerLeftUp size={12} /> up
          </button>
        )}
        {files.map((f) => (
          <button
            key={f.path}
            onClick={async () => {
              if (f.dir) {
                await load(f.path);
              } else {
                try {
                  const r = await dshApi.files(attached.id, f.path);
                  setPreview({ name: f.name, content: r.content ?? "" });
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }
            }}
            className="group flex w-full items-center gap-2 truncate rounded-md px-2 py-1 text-left font-mono text-[12px] text-fg-secondary transition-colors hover:bg-bg-hover hover:text-fg"
          >
            {f.dir ? (
              <Folder size={14} className="shrink-0 text-fg-muted transition-colors group-hover:text-accent" />
            ) : (
              <FileIcon type={f.name} size={16} />
            )}
            <span className="truncate">{f.name}</span>
            {!f.dir && f.size !== undefined && (
              <span className="ml-auto shrink-0 pl-2 text-[10px] text-fg-faint tabular-nums">{(f.size / 1024).toFixed(1)}k</span>
            )}
          </button>
        ))}
        {files.length === 0 && !error && <p className="m-2 rounded-md border border-dashed border-border p-3 text-center text-[12px] text-fg-muted">Empty folder.</p>}
        {error && <p className="px-2 text-[12px] text-danger">{error}</p>}
        {preview && (
          <div className="mt-2 overflow-hidden rounded-lg border border-border bg-bg-surface-100 animate-fade-in-up">
            <p className="flex items-center gap-2 border-b border-border bg-bg-surface-200 px-2.5 py-1.5 font-mono text-[11px] font-medium">
              <FileIcon type={preview.name} size={14} />
              <span className="flex-1 truncate">{preview.name}</span>
              <button onClick={() => setPreview(null)} className="rounded p-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg" title="Close preview">
                <X size={12} />
              </button>
            </p>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap p-2.5 font-mono text-[11px] leading-relaxed">{preview.content}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
