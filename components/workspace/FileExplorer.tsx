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

  if (!attached) return <p className="p-4 text-[12px] text-fg-muted">No workspace attached to this chat.</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Workspace files</h2>
        <p className="mt-0.5 truncate font-mono text-[10.5px] text-fg-muted">{attached.path}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {dir && (
          <button onClick={() => void load(dir.split("/").slice(0, -1).join("/"))} className="mb-1 px-2 text-[12px] text-accent">
            ↑ up
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
            className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[12px] hover:bg-bg-hover"
          >
            {f.dir ? "📁" : "📄"} {f.name}
            {!f.dir && f.size !== undefined && (
              <span className="ml-1 text-[10px] text-fg-muted">{(f.size / 1024).toFixed(1)}k</span>
            )}
          </button>
        ))}
        {files.length === 0 && !error && <p className="px-2 text-[12px] text-fg-muted">Empty folder.</p>}
        {error && <p className="px-2 text-[12px] text-danger">{error}</p>}
        {preview && (
          <div className="mt-2 rounded-lg border border-border bg-bg p-2">
            <p className="mb-1 font-mono text-[11px] font-medium">{preview.name}</p>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-[11px]">{preview.content}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
