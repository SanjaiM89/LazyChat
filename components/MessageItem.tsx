"use client";

import * as React from "react";
import {
  FileText,
  Image as ImageIcon,
  Link2,
  User,
} from "lucide-react";
import type { UIMessage, UIMessagePart } from "ai";
import { cn } from "@/components/ui";
import { Markdown, type Citation } from "@/components/Markdown";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { ToolCard } from "@/components/ToolCard";

/* ------------------------------------------------------------------ */
/*  One chat message (user or assistant), rendering every part type     */
/*  produced by the AI SDK v7 UI message stream:                        */
/*   text, reasoning, tool-<name>/dynamic-tool, source, file, …         */
/* ------------------------------------------------------------------ */

interface NormalizedTool {
  name: string;
  args: Record<string, any> | undefined;
  result: any;
  streaming: boolean;
  errorText?: string;
}

/** Normalize the AI SDK's tool part (v7 `tool-*`/`dynamic-tool` + legacy `tool-invocation`). */
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
    };
  }
  return null;
}

/* ------------------------------ File chip ------------------------------ */

function FileChip({
  url,
  mediaType,
  filename,
}: {
  url: string;
  mediaType: string;
  filename?: string;
}) {
  const isImage = mediaType.startsWith("image/");
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5",
        "text-[12px] text-fg-secondary hover:border-accent/40 hover:text-accent transition-colors",
      )}
    >
      {isImage ? (
        <ImageIcon size={13} className="text-accent shrink-0" />
      ) : (
        <FileText size={13} className="text-accent shrink-0" />
      )}
      <span className="truncate max-w-[160px]">{filename || "attachment"}</span>
    </a>
  );
}

/* ---------------------------- Source chip ----------------------------- */

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
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2.5 py-1 text-[11.5px] text-fg-secondary hover:border-accent/40 hover:text-accent transition-colors"
          >
            <Link2 size={11} className="text-accent" />
            <span className="truncate max-w-[180px]">{s.title || host}</span>
          </a>
        );
      })}
    </div>
  );
}

/* --------------------------- Assistant body --------------------------- */

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

  // Collect every web-search result in this message into one global,
  // URL-deduped citation list so [1], [2] … in the answer map to a card.
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
            {isLastText && (
              <span className="cursor-caret inline-block h-[1em] w-[2px] align-text-bottom bg-accent animate-pulse" />
            )}
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
          <div key={i} className="my-1 h-px w-full bg-border/60" />,
        );
        break;
      }
      case "custom":
      case "data-start":
      case "data-end":
      case "data-file":
        break; // handled elsewhere / no visual needed
      default: {
        // tool parts — both static (tool-*) and dynamic
        const normalized = normalizeTool(part);
        if (normalized) {
          // Rewrite per-search result numbers to the message-global citation
          // numbers so the card badges match the [n] pills in the answer.
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

  // Provider-native sources (Anthropic/Google) that aren't part of the
  // webSearch tool also get citation numbers so everything is clickable.
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

/* ----------------------------- MessageItem ---------------------------- */

export function MessageItem({
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
    const imageParts = fileParts.filter((p) => p.mediaType.startsWith("image/"));
    const otherParts = fileParts.filter((p) => !p.mediaType.startsWith("image/"));

    return (
      <div className="group flex gap-3 px-1 py-3 animate-fade-in-up">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-strong text-[11px] font-semibold text-white shadow-sm">
          <User size={14} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5 space-y-2">
          {imageParts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {imageParts.map((p: any, i: number) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={p.url}
                  alt={p.filename || "attachment"}
                  className="max-h-40 max-w-[220px] rounded-xl border border-border object-cover"
                />
              ))}
            </div>
          )}
          {otherParts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
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
            <div className="user-text text-[14.5px] leading-relaxed text-fg whitespace-pre-wrap">
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
    return (
      <div className="px-1 py-3 animate-fade-in-up">
        <AssistantParts parts={message.parts} streaming={isLast && streaming} />
      </div>
    );
  }

  // system / other roles — render plainly
  return (
    <div className="px-1 py-3">
      <div className="rounded-xl border border-border bg-bg-subtle px-4 py-2 text-[13px] text-fg-muted">
        {message.parts
          .filter((p) => p.type === "text")
          .map((p: any) => p.text)
          .join("")}
      </div>
    </div>
  );
}
