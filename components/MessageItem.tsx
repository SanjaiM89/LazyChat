"use client";

import * as React from "react";
import { Image as ImageIcon } from "lucide-react";
import type { UIMessage, UIMessagePart } from "ai";
import { cn } from "@/components/ui";
import { Markdown, type Citation } from "@/components/Markdown";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { ToolCard } from "@/components/ToolCard";
import { isSubchatMessage } from "@/lib/subchat-context";
import { OmniaMark } from "@/components/brand/OmniaLogo";
import { SiteFavicon } from "@/components/brand/BrandIcon";
import { FileIcon } from "@/components/brand/FileIcon";


interface NormalizedTool {
  name: string;
  args: Record<string, any> | undefined;
  result: any;
  streaming: boolean;
  errorText?: string;
  /** The transcript's call id — the answer key for an ask-user question. */
  toolCallId?: string;
}

function normalizeTool(part: any): NormalizedTool | null {
  if (part.type === "dynamic-tool") {
    const done = ["output-available", "output-error", "output-denied"].includes(
      part.state,
    );
    return {
      name: part.toolName,
      args: (part.input as Record<string, any>) ?? undefined,
      result: done ? part.output : undefined,
      streaming: !done,
      errorText: part.errorText,
      toolCallId: part.toolCallId,
    };
  }
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    const done = ["output-available", "output-error", "output-denied"].includes(
      part.state,
    );
    return {
      name: part.type.slice("tool-".length),
      args: (part.input as Record<string, any>) ?? undefined,
      result: done ? part.output : undefined,
      streaming: !done,
      errorText: part.errorText,
      toolCallId: part.toolCallId,
    };
  }
  if (part.type === "tool-invocation" && part.toolInvocation) {
    const ti = part.toolInvocation;
    return {
      name: ti.toolName,
      args: ti.args,
      result: ti.state === "result" ? ti.result : undefined,
      streaming: ti.state !== "result",
      errorText: ti.error,
      toolCallId: ti.toolCallId,
    };
  }
  return null;
}


function FileChip({
  url,
  mediaType,
  filename,
}: {
  url: string;
  mediaType: string;
  filename?: string;
}) {
  const isImage = (mediaType ?? "").startsWith("image/");
  return (
    <a
      href={url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "lift group flex items-center gap-2 rounded-md border border-border bg-bg-surface-200 py-1 pl-1.5 pr-2.5",
        "text-[12px] text-fg-secondary hover:border-border-strong hover:text-fg",
      )}
    >
      {isImage ? (
        <ImageIcon size={14} className="text-accent shrink-0" />
      ) : (
        <FileIcon type={filename || mediaType} size={22} />
      )}
      <span className="truncate max-w-[160px]">{filename || "attachment"}</span>
    </a>
  );
}


function SourceChips({ urls }: { urls: { url: string; title?: string }[] }) {
  if (!urls.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {urls.map((s, i) => {
        let host = "";
        try {
          host = new URL(s.url).hostname.replace(/^www\./, "");
        } catch {
          host = s.url;
        }
        return (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-surface-200 py-1 pl-1.5 pr-2.5 text-[11.5px] text-fg-secondary transition-colors hover:border-brand/40 hover:text-fg"
          >
            <SiteFavicon hostname={host} size={13} />
            <span className="truncate max-w-[180px]">{s.title || host}</span>
          </a>
        );
      })}
    </div>
  );
}


function AssistantParts({
  parts,
  streaming,
}: {
  parts: UIMessagePart<any, any>[];
  streaming: boolean;
}) {
  const [selected, setSelected] = React.useState<number | null>(null);
  const toggleSelect = React.useCallback((n: number) => {
    setSelected((s) => (s === n ? null : n));
  }, []);

  const citations: Citation[] = [];
  const urlToN = new Map<string, number>();
  const pushCitation = (r: any) => {
    const url = String(r?.url || "");
    if (!url || urlToN.has(url)) return;
    let hostname = String(r?.hostname || "");
    if (!hostname) {
      try {
        hostname = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        hostname = url;
      }
    }
    const n = citations.length + 1;
    urlToN.set(url, n);
    citations.push({
      n,
      title: String(r?.title || hostname || url),
      url,
      hostname,
      description: typeof r?.description === "string" ? r.description : undefined,
    });
  };
  for (const part of parts) {
    const t = normalizeTool(part);
    if (t?.name === "webSearch" && Array.isArray(t.result?.results)) {
      for (const r of t.result.results) pushCitation(r);
    }
  }
  const sources: { url: string; title?: string }[] = [];

  const out: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    switch (part.type) {
      case "text": {
        const isLastText =
          streaming &&
          parts.slice(i + 1).every((p) => p.type !== "text");
        out.push(
          <div key={i}>
            <Markdown
              content={(part as any).text ?? ""}
              citations={citations.length ? citations : undefined}
              selectedCitation={selected}
              onSelectCitation={toggleSelect}
            />
            {isLastText && <span className="stream-caret" aria-hidden />}
          </div>,
        );
        break;
      }
      case "reasoning": {
        const p = part as any;
        const reasoningStreaming =
          streaming && (p.state === "streaming" || p.state === undefined);
        out.push(
          <ThinkingBlock
            key={i}
            text={p.text}
            streaming={reasoningStreaming}
          />,
        );
        break;
      }
      case "reasoning-file": {
        const p = part as any;
        out.push(
          <div key={i} className="mb-2">
            <FileChip url={p.url} mediaType={p.mediaType ?? "text/plain"} />
          </div>,
        );
        break;
      }
      case "source-url": {
        const p = part as any;
        sources.push({ url: p.url, title: p.title });
        break;
      }
      case "source-document": {
        const p = part as any;
        if (p.filename)
          sources.push({ url: p.url || "#", title: p.title || p.filename });
        break;
      }
      case "step-start": {
        out.push(
          <div key={i} className="my-2 h-px w-full bg-gradient-to-r from-transparent via-border to-transparent" />,
        );
        break;
      }
      case "custom":
      case "data-start":
      case "data-end":
      case "data-file":
        break;
      default: {
        const normalized = normalizeTool(part);
        if (normalized) {
          let result = normalized.result;
          let base = 0;
          if (normalized.name === "webSearch" && Array.isArray(result?.results)) {
            base = citations.length
              ? (urlToN.get(String(result.results[0]?.url)) ?? 1) - 1
              : 0;
            result = {
              ...result,
              results: result.results.map((r: any) => ({
                ...r,
                n: urlToN.get(String(r?.url)) ?? r?.n,
              })),
            };
          }
          out.push(
            <ToolCard
              key={i}
              toolName={normalized.name}
              args={normalized.args}
              result={result}
              streaming={normalized.streaming}
              errorText={normalized.errorText}
              toolCallId={normalized.toolCallId}
              citationBase={base}
              selectedCitation={selected}
              onSelectCitation={toggleSelect}
            />,
          );
        }
        break;
      }
    }
  });

  for (const s of sources) {
    if (s.url && s.url !== "#" && !urlToN.has(s.url)) {
      const n = citations.length + 1;
      urlToN.set(s.url, n);
      citations.push({ n, title: s.title || s.url, url: s.url, hostname: "" });
    }
  }

  return (
    <div className="min-w-0 flex-1">
      {sources.length > 0 && <SourceChips urls={sources} />}
      {out}
    </div>
  );
}


function ContextBadge() {
  return (
    <span
      title="This turn came from the subchat — shared context both chats can see"
      className="inline-flex w-fit items-center rounded-full border border-brand/30 bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent"
    >
      via subchat
    </span>
  );
}

function MessageItemComponent({
  message,
  isLast,
  streaming,
}: {
  message: UIMessage;
  isLast: boolean;
  streaming: boolean;
}) {
  const role = message.role;
  const fileParts = message.parts.filter((p) => p.type === "file") as any[];

  if (role === "user") {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p: any) => p.text ?? "")
      .join("");
    const imageParts = fileParts.filter((p) => (p.mediaType ?? "").startsWith("image/"));
    const otherParts = fileParts.filter((p) => !(p.mediaType ?? "").startsWith("image/"));
    const viaSubchat = isSubchatMessage(message);

    return (
      <div className="chat-message group flex justify-end px-1 py-3 animate-fade-in-up">
        <div className="flex max-w-[85%] min-w-0 flex-col items-end gap-2">
          {viaSubchat && <ContextBadge />}
          {imageParts.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {imageParts.map((p: any, i: number) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={p.url}
                  alt={p.filename || "attachment"}
                  className="max-h-40 max-w-[220px] rounded-lg border border-border object-cover shadow-soft transition-transform duration-300 hover:scale-[1.02]"
                />
              ))}
            </div>
          )}
          {otherParts.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {otherParts.map((p: any, i: number) => (
                <FileChip
                  key={i}
                  url={p.url}
                  mediaType={p.mediaType}
                  filename={p.filename}
                />
              ))}
            </div>
          )}
          {text.trim() && (
            <div className="user-text rounded-xl rounded-br-sm border border-border bg-bg-surface-200 px-4 py-2.5 text-[14.5px] leading-relaxed text-fg whitespace-pre-wrap shadow-[0_1px_0_rgba(0,0,0,0.04)]">
              {text}
            </div>
          )}
          {!text.trim() && fileParts.length === 0 && (
            <div className="text-[14.5px] text-fg-muted italic">(empty)</div>
          )}
        </div>
      </div>
    );
  }

  if (role === "assistant") {
    const live = isLast && streaming;
    return (
      <div className="chat-message flex gap-3 px-1 py-3 animate-fade-in-up">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
          <OmniaMark size={22} animated={live} />
        </span>
        <div className="min-w-0 flex-1">
          {isSubchatMessage(message) && <ContextBadge />}
          <AssistantParts parts={message.parts} streaming={live} />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-message px-1 py-3">
      <div className="rounded-lg border border-border bg-bg-surface-100 px-4 py-2 text-[13px] text-fg-muted">
        {message.parts
          .filter((p) => p.type === "text")
          .map((p: any) => p.text)
          .join("")}
      </div>
    </div>
  );
}

// A streaming response changes the messages array on every update. Keep completed
// turns mounted but skip their markdown/tool rendering when their data is stable.
export const MessageItem = React.memo(MessageItemComponent);
