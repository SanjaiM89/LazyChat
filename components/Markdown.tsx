"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";


function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
    }
  };
  return (
    <div className="group relative">
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/40 border-b border-white/10 rounded-t-lg">
        <span className="text-[11px] font-medium text-white/60 tracking-wide uppercase">
          {language || "code"}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <pre className="!m-0 !rounded-t-none !border-t-0">
          <code className={language ? `language-${language}` : ""}>{code}</code>
        </pre>
      </div>
    </div>
  );
}

export interface Citation {
  n: number;
  title: string;
  url: string;
  hostname: string;
  description?: string;
}

function CitationPill({
  n,
  citation,
  active,
  onSelect,
}: {
  n: number;
  citation?: Citation;
  active: boolean;
  onSelect?: (n: number) => void;
}) {
  const label = `[${n}]`;
  if (!citation) {
    return <span className="text-fg-muted">{label}</span>;
  }
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect?.(n);
        requestAnimationFrame(() => {
          document
            .getElementById(`cite-${n}`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }}
      title={`${citation.title}\n${citation.url}${citation.description ? `\n\n${citation.description.slice(0, 220)}` : ""}\n\nClick to see where this was referenced.`}
      className={`mx-0.5 inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-md border px-1 align-super text-[10.5px] font-semibold leading-none transition-colors ${
        active
          ? "border-accent bg-accent text-white"
          : "border-accent/40 bg-accent-soft text-accent hover:bg-accent hover:text-white"
      }`}
    >
      {n}
    </button>
  );
}

function Link({
  href,
  children,
  citations,
  selected,
  onSelect,
}: {
  href?: string;
  children?: React.ReactNode;
  citations?: Citation[];
  selected?: number | null;
  onSelect?: (n: number) => void;
}) {
  const internal = href && /^citation:(\d+)$/.exec(href);
  if (internal) {
    const n = parseInt(internal[1], 10);
    return (
      <CitationPill
        n={n}
        citation={citations?.find((c) => c.n === n)}
        active={selected === n}
        onSelect={onSelect}
      />
    );
  }
  const match = href && citations?.find((c) => c.url === href);
  if (match) {
    return (
      <>
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
        <CitationPill
          n={match.n}
          citation={match}
          active={selected === match.n}
          onSelect={onSelect}
        />
      </>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function preprocessCitations(text: string, count: number): string {
  if (!count || !text.includes("[")) return text;
  const parts = text.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/\[(\d{1,3})\]/g, (m, num) => {
      const n = parseInt(num, 10);
      if (n < 1 || n > count) return m;
      return `[${n}](citation:${n})`;
    });
  }
  return parts.join("");
}

export function Markdown({
  content,
  className,
  citations,
  selectedCitation,
  onSelectCitation,
}: {
  content: string;
  className?: string;
  citations?: Citation[];
  selectedCitation?: number | null;
  onSelectCitation?: (n: number) => void;
}) {
  const body = citations?.length
    ? preprocessCitations(content, citations.length)
    : content;
  return (
    <div className={`md ${className || ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          a: (props) => (
            <Link
              {...(props as any)}
              citations={citations}
              selected={selectedCitation}
              onSelect={onSelectCitation}
            />
          ),
          pre: ({ children }) => {
            const child = React.Children.toArray(children)[0] as React.ReactElement;
            if (child && child.type === "code") {
              const props = child.props as { className?: string; children?: string };
              const lang = /language-(\w+)/.exec(props.className || "")?.[1] || "";
              return <CodeBlock language={lang} code={String(props.children ?? "")} />;
            }
            return <pre>{children}</pre>;
          },
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
