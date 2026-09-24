"use client";

import * as React from "react";
import { useRef, useState } from "react";
import {
  ArrowUp,
  Square,
  Paperclip,
  X,
  Globe,
  FileText,
  Bot,
  Brain,
} from "lucide-react";
import type { FileUIPart } from "ai";
import { cn, IconButton, Tooltip } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import { DEFAULT_DISPLAY } from "@/lib/display";
import { modelSupportsThinking } from "@/lib/models";
import type { ChatController } from "@/lib/use-chat";
import { activeRunFor } from "@/lib/app-store";
import { ModelPicker } from "@/components/ModelPicker";
import { SandboxMini } from "@/components/SandboxMini";
import { BackgroundRunBar } from "@/components/BackgroundRunBar";

/* ------------------------------------------------------------------ */
/*  Composer: message box with attachments, tool toggles, model picker */
/* ------------------------------------------------------------------ */

const TOOL_BUTTONS: {
  id: string;
  label: string;
  icon: React.ReactNode;
  tooltip: string;
}[] = [
  {
    id: "webSearch",
    label: "Search",
    icon: <Globe size={15} />,
    tooltip: "Search the web (add Tavily/Brave/Serper keys via Search providers in the sidebar)",
  },
  {
    id: "createArtifact",
    label: "Artifacts",
    icon: <FileText size={15} />,
    tooltip: "Create viewable artifacts (code, HTML, SVG, …)",
  },
  {
    id: "runAgentTask",
    label: "Agents",
    icon: <Bot size={15} />,
    tooltip: "Run autonomous agents in Docker sandboxes",
  },
];

function ToolToggle({
  id,
  label,
  icon,
  tooltip,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  tooltip: string;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <Tooltip text={tooltip}>
      <button
        onClick={() => onToggle(id)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium transition-colors",
          checked
            ? "bg-accent-soft text-accent"
            : "text-fg-muted hover:bg-bg-hover hover:text-fg-secondary",
        )}
      >
        {icon}
        {label}
      </button>
    </Tooltip>
  );
}

export function Composer({
  chat,
  disabled,
}: {
  chat: ChatController;
  disabled?: boolean;
}) {
  const settings = useAppStore((s) => s.settings);
  const toggleTool = useAppStore((s) => s.toggleTool);
  const setSettings = useAppStore((s) => s.setSettings);
  const runs = useAppStore((s) => s.runs);
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const contentWidth = useAppStore((s) => s.display?.contentWidth) ?? DEFAULT_DISPLAY.contentWidth;

  const [text, setText] = useState("");
  const [pending, setPending] = useState<FileUIPart[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isBusy = chat.status === "submitted" || chat.status === "streaming";
  // A reply for this conversation is being generated on the server and this tab
  // isn't watching it (reloaded page, another tab, or we switched away).
  const liveRun = activeRunFor(runs, activeConversationId);
  const backgroundRun = isBusy ? null : liveRun;
  const thinkingSupported = modelSupportsThinking(
    settings.provider,
    settings.model,
  );

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  const handleUpload = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      form.append("conversationId", activeConversationId || "");
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error("upload failed");
      const { artifacts } = await res.json();
      const parts: FileUIPart[] = artifacts.map((a: any) => ({
        type: "file",
        mediaType: a.mime || "application/octet-stream",
        filename: a.filename,
        url: `/api/files/${a.id}/${encodeURIComponent(a.filename)}`,
      }));
      setPending((p) => [...p, ...parts]);
    } catch (e) {
      console.error(e);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const hasFiles = (e: React.DragEvent) => {
    try {
      return Array.from(e.dataTransfer.types || []).includes("Files");
    } catch {
      return true;
    }
  };

  const handleSend = () => {
    const value = text.trim();
    if (!value && !pending.length) return;
    if (isBusy) return;
    // A background run owns this conversation — stop it first, so the typed
    // message isn't swallowed.
    if (backgroundRun) return;
    chat.send(value, pending.length ? pending : undefined);
    setText("");
    setPending([]);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) el.style.height = "auto";
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="sticky bottom-0 z-20 bg-gradient-to-t from-bg via-bg/95 to-transparent px-3 pb-3 pt-2 sm:px-6">
      <div className="mx-auto w-full" style={{ maxWidth: contentWidth }}>
        {/* Manus-style mini computer shown above the chat box while a sandbox runs */}
        <SandboxMini />

        {/* Generating on the server, but this tab isn't watching it */}
        {backgroundRun && <BackgroundRunBar run={backgroundRun} chat={chat} />}

        <div
          className={cn(
            "relative rounded-[22px] border border-border-strong bg-bg-elevated shadow-soft transition-all",
            "focus-within:border-accent/50 focus-within:shadow-pop",
            dragging && "border-accent border-dashed",
          )}
          onDragEnter={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            if (uploading || isBusy) return;
            const files = e.dataTransfer.files;
            if (files?.length) void handleUpload(files);
          }}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[22px] bg-accent/10 backdrop-blur-[1px]">
              <p className="rounded-full border border-accent/40 bg-bg-elevated px-4 py-2 text-[13px] font-medium text-accent shadow-soft">
                Drop files to attach{uploading ? " (uploading…)" : ""}
              </p>
            </div>
          )}
          {/* pending attachments */}
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {pending.map((p, i) => (
                <span
                  key={`${p.url}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-[12px] text-fg-secondary"
                >
                  <FileText size={12} className="text-accent" />
                  <span className="max-w-[140px] truncate">{p.filename}</span>
                  <button
                    onClick={() =>
                      setPending((arr) => arr.filter((_, j) => j !== i))
                    }
                    className="text-fg-muted hover:text-danger"
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const files = e.clipboardData?.files;
              if (files?.length && !uploading && !isBusy) {
                e.preventDefault();
                void handleUpload(files);
              }
            }}
            placeholder="Ask anything… (drop files to attach)"
            disabled={disabled}
            className={cn(
              "w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14.5px] leading-relaxed text-fg placeholder:text-fg-muted/70",
              "focus:outline-none disabled:opacity-50",
            )}
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
            <div className="flex items-center gap-0.5">
              <Tooltip text="Attach a file">
                <IconButton
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || isBusy}
                  className="h-8 w-8"
                  title="Attach a file"
                >
                  {uploading ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Paperclip size={16} />
                  )}
                </IconButton>
              </Tooltip>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
              />

              {TOOL_BUTTONS.map((t) => (
                <ToolToggle
                  key={t.id}
                  id={t.id}
                  label={t.label}
                  icon={t.icon}
                  tooltip={t.tooltip}
                  checked={settings.tools.includes(t.id)}
                  onToggle={toggleTool}
                />
              ))}

              {thinkingSupported && (
                <Tooltip
                  text={
                    settings.thinking
                      ? "Thinking is on — the model reasons before answering"
                      : "Turn on extended thinking"
                  }
                >
                  <button
                    onClick={() =>
                      setSettings({ thinking: !settings.thinking })
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium transition-colors",
                      settings.thinking
                        ? "bg-info-soft text-info"
                        : "text-fg-muted hover:bg-bg-hover hover:text-fg-secondary",
                    )}
                  >
                    <Brain size={15} />
                    Thinking
                  </button>
                </Tooltip>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <ModelPicker />
              {isBusy ? (
                <button
                  onClick={() => chat.stop()}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-transform hover:scale-105 active:scale-95"
                  title="Stop generating"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={(!text.trim() && !pending.length) || disabled || !!backgroundRun}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-sm",
                    "transition-all hover:scale-105 hover:bg-accent-strong active:scale-95 disabled:opacity-40 disabled:pointer-events-none",
                  )}
                  title={
                    backgroundRun
                      ? "A reply is generating in the background — stop it to send"
                      : "Send message"
                  }
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-1.5 text-center text-[11px] text-fg-muted/80">
          Claude Code can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
}
