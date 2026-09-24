"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Check, Copy, Download, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { Markdown } from "@/components/Markdown";


export function MarkdownViewer({ url }: { url: string }) {
  return <TextViewer url={url} renderAs="markdown" />;
}

export function CodeViewer({ url, language }: { url: string; language?: string }) {
  return <TextViewer url={url} renderAs="code" language={language} />;
}

function filenameFromUrl(url: string, fallback: string): string {
  const last = decodeURIComponent(url.split("?")[0].split("/").pop() || "");
  return last || fallback;
}

function TextViewer({
  url,
  renderAs,
  language,
}: {
  url: string;
  renderAs: "markdown" | "code" | "text";
  language?: string;
}) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await (await fetch(url)).text();
        if (!cancelled) setContent(text);
      } catch {
        if (!cancelled) setContent("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (content === null) {
    return (
      <div className="flex justify-center py-10 text-[13px] text-fg-muted">
        <Loader2 className="animate-spin mr-2 text-accent" size={14} />
        Loading…
      </div>
    );
  }

  if (renderAs === "markdown") {
    return (
      <MarkdownWithToolbar
        content={content}
        filename={filenameFromUrl(url, "document.md")}
      />
    );
  }

  return (
    <div className="h-full overflow-auto">
      <pre className="mx-auto max-w-[820px] px-6 py-5 text-[13px] leading-relaxed">
        <code className={language ? `language-${language}` : ""}>
          {content}
        </code>
      </pre>
    </div>
  );
}


function MarkdownWithToolbar({
  content,
  filename,
}: {
  content: string;
  filename: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const flash = (which: "rich" | "md") => {
    if (which === "rich") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } else {
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 1400);
    }
  };

  const copyRich = async () => {
    const el = bodyRef.current;
    const plain = el?.innerText || el?.textContent || content;
    try {
      if (el && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        const item = new ClipboardItem({
          "text/html": new Blob([el.innerHTML], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      flash("rich");
    } catch {
      try {
        await navigator.clipboard.writeText(plain);
        flash("rich");
      } catch {
      }
    }
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(content);
      flash("md");
    } catch {
    }
  };

  const download = () => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const toolbar = (
    <div className="flex items-center gap-1 border-b border-border bg-bg-elevated px-3 py-1.5">
      <span className="mr-auto truncate text-[12px] font-medium text-fg-muted">
        {filename}
      </span>
      <button
        onClick={copyRich}
        title="Copy formatted text (paste into OneNote/Word without markdown symbols)"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        onClick={copyMarkdown}
        title="Copy raw markdown source"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
      >
        {copiedMd ? <Check size={13} /> : <Copy size={13} />}
        {copiedMd ? "Copied" : "Copy MD"}
      </button>
      <button
        onClick={download}
        title="Download markdown (.md)"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
      >
        <Download size={13} />
        Download
      </button>
      <button
        onClick={() => setFullscreen((v) => !v)}
        title={fullscreen ? "Exit fullscreen (Esc)" : "View fullscreen"}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
      >
        {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        {fullscreen ? "Exit" : "Fullscreen"}
      </button>
    </div>
  );

  const body = (
    <div ref={fullscreen ? undefined : bodyRef} className="mx-auto max-w-[820px] px-6 py-5">
      <Markdown content={content} />
    </div>
  );

  if (!fullscreen) {
    return (
      <div className="flex h-full flex-col">
        {toolbar}
        <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {toolbar}
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      <div className="fixed inset-0 z-50 flex flex-col bg-bg">
        {toolbar}
        <div className="min-h-0 flex-1 overflow-auto">
          <div ref={bodyRef} className="mx-auto max-w-[900px] px-8 py-6">
            <Markdown content={content} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function HtmlViewer({ url }: { url: string }) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const text = await (await fetch(url)).text();
      if (!cancelled) setSrcDoc(text);
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="h-full">
      <iframe
        title="HTML preview"
        srcDoc={srcDoc ?? undefined}
        className="h-full w-full border-0 bg-white"
        sandbox="allow-same-origin allow-scripts allow-popups"
      />
    </div>
  );
}

export function ImageViewer({ url, label }: { url: string; label?: string }) {
  return (
    <div className="flex h-full items-start justify-center overflow-auto bg-[radial-gradient(circle,#2a2a28_1px,transparent_1px)] bg-[length:16px_16px] bg-bg-subtle/60 p-6">
      <img
        src={url}
        alt={label || "image"}
        className="max-h-full max-w-full rounded-lg border border-border shadow-soft"
      />
    </div>
  );
}


function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  row.push(cur);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function CsvViewer({ url }: { url: string }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const text = await (await fetch(url)).text();
      if (!cancelled) setRows(parseCSV(text));
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!rows) {
    return (
      <div className="flex justify-center py-10 text-[13px] text-fg-muted">
        <Loader2 className="animate-spin mr-2 text-accent" size={14} /> Loading…
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[820px] p-5">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i === 0 ? "bg-bg-inset font-semibold" : ""}>
                  {r.map((cell, j) => (
                    <td
                      key={j}
                      className="border-b border-border px-3 py-1.5 text-fg whitespace-nowrap"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
