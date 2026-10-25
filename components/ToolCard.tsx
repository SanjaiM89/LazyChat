"use client";

import * as React from "react";
import {
  FileText,
  SquareTerminal,
  ChevronDown,
  Boxes,
  ArrowUpRight,
  Loader2,
  Download,
  FileCode2,
  FilePlus,
  Monitor,
  Pencil,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import { AskUserCard } from "@/components/AskUserCard";
import { PlanReviewCard } from "@/components/PlanReviewCard";
import { TodoCallCard } from "@/components/dsh/TodoPanel";
import { TerminalBlock } from "@/components/dsh/TerminalBlock";
import { terminalCardModel, terminalFailed } from "@/components/dsh/terminal-card-model";
import { TextShimmer } from "@/components/dsh/TextShimmer";
import { GenUiCard } from "@/components/genui/GenUiCard";
import { DocumentCard } from "@/components/DocumentCard";
import { BrandIcon, connectorIconKey, languageIconKey } from "@/components/brand/BrandIcon";
import { FileIcon } from "@/components/brand/FileIcon";
import { TOOL_CATALOG } from "@/lib/agent/catalog";


export function ToolCard({
  toolName,
  args,
  result,
  streaming,
  open,
  errorText,
  toolCallId,
  citationBase = 0,
  selectedCitation,
  onSelectCitation,
}: {
  toolName: string;
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
  open?: boolean;
  errorText?: string;
  /** The transcript's call id — the answer key for an ask-user question. */
  toolCallId?: string;
  citationBase?: number;
  selectedCitation?: number | null;
  onSelectCitation?: (n: number) => void;
}) {
  // An ask-user question owns the interaction: it is a composer while the call
  // is pending and a read-only transcript once answered, so it never renders
  // through the generic row's disclosure.
  if (toolName === "ask_user_question") {
    return (
      <AskUserCard
        toolCallId={toolCallId ?? ""}
        questions={Array.isArray(args?.questions) ? args.questions : []}
        result={result}
        streaming={streaming}
        errorText={errorText}
      />
    );
  }
  if (toolName === "todo_write") {
    return (
      <TodoCallCard args={args} result={result} streaming={streaming} errorText={errorText} />
    );
  }
  if (toolName === "exit_plan_mode") {
    return (
      <PlanReviewCard
        toolCallId={toolCallId ?? ""}
        plan={typeof args?.plan === "string" ? args.plan : ""}
        result={result}
        streaming={streaming}
        errorText={errorText}
      />
    );
  }
  if (toolName === "web_search") {
    return (
      <SearchCardWrapper
        args={args}
        result={result}
        streaming={streaming}
        citationBase={citationBase}
        selectedCitation={selectedCitation}
        onSelectCitation={onSelectCitation}
      />
    );
  }
  if (toolName === "render_ui") {
    return <GenUiCard args={args} result={result} streaming={streaming} errorText={errorText} />;
  }
  if (toolName === "createArtifact" || toolName === "generate_document") {
    return <DocumentCard toolName={toolName} args={args} result={result} streaming={streaming} errorText={errorText} />;
  }
  if (toolName === "runAgentTask") {
    return (
      <AgentTaskCard
        args={args}
        result={result}
        streaming={streaming}
        errorText={errorText}
      />
    );
  }
  if (toolName.startsWith("computer_")) {
    return (
      <ComputerCard
        toolName={toolName}
        args={args}
        result={result}
        streaming={streaming}
        errorText={errorText}
      />
    );
  }
  return (
    <ToolRow
      toolName={toolName}
      args={args}
      result={result}
      streaming={streaming}
      errorText={errorText}
    />
  );
}

function SearchCardWrapper({
  args,
  result,
  streaming,
  citationBase = 0,
  selectedCitation,
  onSelectCitation,
}: {
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
  citationBase?: number;
  selectedCitation?: number | null;
  onSelectCitation?: (n: number) => void;
}) {
  const { SearchCard } = require("@/components/SearchCard");
  return (
    <SearchCard
      query={args?.query}
      results={result?.results}
      streaming={streaming}
      baseIndex={citationBase}
      selected={selectedCitation}
      onSelect={onSelectCitation}
    />
  );
}

function AgentTaskCard({
  args,
  result,
  streaming,
  errorText,
}: {
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
  errorText?: string;
}) {
  const setPanel = useAppStore((s) => s.setPanel);
  const [expanded, setExpanded] = React.useState(true);

  const status = result?.status || (streaming ? "running" : "queued");
  const progress = result?.progress ?? (streaming ? undefined : 0);
  const files = result?.files || [];
  const summary = result?.summary;

  return (
    <div className={`mb-2 overflow-hidden rounded-lg border border-border bg-bg-surface-100 animate-fade-in-up ${streaming ? "beam-border" : ""}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-bg-hover"
      >
        <span className="brand-tile relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-surface-200">
          <BrandIcon name="bash" size={17} fallback={<SquareTerminal size={15} />} />
          {streaming && <span className="live-dot absolute -right-0.5 -top-0.5 !h-2 !w-2" />}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13.5px] font-medium text-fg">
            {args?.task?.slice(0, 90) || "Agent task"}
          </span>
          <span className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
            <span className="eyebrow !text-[10px]">Sandbox</span>
            <span className="text-fg-faint">·</span>
            <span className={streaming ? "text-shine" : ""}>{status}</span>
            {status === "done" && files.length > 0 ? <span>· {files.length} file(s)</span> : null}
          </span>
        </span>
        {streaming && <Loader2 size={14} className="animate-spin text-accent" />}
        <ChevronDown size={15} className={`text-fg-muted transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border px-3.5 pb-3 pt-2.5 animate-fade-in">
          {errorText && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-2.5 py-2 text-[12.5px] text-danger">
              {errorText}
            </p>
          )}
          {typeof progress === "number" && progress < 100 && (
            <div className="h-1 overflow-hidden rounded-full bg-bg-surface-300">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand transition-all duration-700 [transition-timing-function:var(--ease-out)]"
                style={{ width: `${Math.max(2, progress)}%` }}
              />
            </div>
          )}
          {summary && (
            <p className="text-[12.5px] text-fg-secondary leading-relaxed whitespace-pre-wrap">
              {summary}
            </p>
          )}
          {files.length > 0 && (
            <div className="mt-1 border-t border-border pt-2.5">
              <p className="eyebrow mb-1.5">
                Produced files
              </p>
              <div className="space-y-1.5 stagger [--stagger:40ms]">
                {files.map((f: any, i: number) => {
                  return (
                    <div
                      key={i}
                      className="lift group flex items-center gap-3 rounded-md border border-border bg-bg-surface-200 px-3 py-2 hover:border-border-strong"
                    >
                      <FileIcon type={f.type || f.name} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-fg truncate">
                          {f.name || f.filename}
                        </span>
                        <span className="text-[11px] text-fg-muted">
                          {fileTypeLabel(f.type || f.name)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-[26px] items-center gap-1 rounded-md border border-border-strong bg-bg-control px-2 text-[12px] text-fg-secondary transition-colors hover:border-brand/40 hover:text-accent"
                          title="Open file"
                        >
                          <ArrowUpRight size={12} />
                          Open
                        </a>
                        <a
                          href={f.url}
                          download
                          className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border-strong bg-bg-control text-fg-muted transition-colors hover:border-brand/40 hover:text-accent"
                          title="Download"
                        >
                          <Download size={12} />
                        </a>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {status === "done" && files.length === 0 && (
            <p className="text-[12px] text-warning">
              The agent finished but produced no files in /workspace/out.
            </p>
          )}
          <button
            onClick={() => setPanel("agents")}
            className="group inline-flex items-center gap-1 text-[12px] text-brand-link hover:underline underline-offset-2"
          >
            View live run in Agents <ArrowUpRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function fileTypeLabel(typeOrName: string) {
  const t = String(typeOrName || "").toLowerCase();
  if (t.includes("pdf")) return "PDF document";
  if (t.includes("xls")) return "Spreadsheet";
  if (t.includes("csv")) return "CSV data";
  if (t.includes("doc")) return "Word document";
  if (t.includes("image") || /\.(png|jpe?g|gif|webp)$/.test(t)) return "Image";
  if (t.includes("code") || /\.(py|js|ts|json|tsx|jsx)$/.test(t)) return "Code file";
  if (t.includes("markdown") || /\.md$/.test(t)) return "Markdown";
  return "File";
}

function ComputerCard({
  toolName,
  args,
  result,
  streaming,
  errorText,
}: {
  toolName: string;
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
  errorText?: string;
}) {
  const setPanel = useAppStore((s) => s.setPanel);
  const action = toolName.replace(/^computer_/, "");
  const summary = args
    ? action === "navigate"
      ? args.url
      : action === "click"
        ? args.selector || (args.x !== undefined ? `(${args.x}, ${args.y})` : "")
        : action === "type"
          ? `"${String(args.text || "").slice(0, 60)}"${args.enter ? " ⏎" : ""}`
          : action === "press"
            ? args.key
            : action === "scroll" || action === "nav"
              ? args.direction || args.op || ""
              : ""
    : "";
  const pageTitle = result?.title || result?.url;

  return (
    <button
      onClick={() => setPanel("sandbox")}
      className={`group mb-2 flex w-full items-center gap-3 rounded-lg border border-border bg-bg-surface-100 px-3.5 py-2.5 text-left transition-all hover:border-border-strong hover:bg-bg-surface-200 animate-fade-in-up ${streaming ? "beam-border" : ""}`}
      title="Open the Chromium panel to watch / take over"
    >
      <span className="brand-tile brand-tile-glow relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-surface-200">
        <BrandIcon name="chrome" size={17} fallback={<Monitor size={15} />} />
        {streaming && <span className="live-dot absolute -right-0.5 -top-0.5 !h-2 !w-2" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-fg">
          Computer: {action}
          {summary ? <span className="font-normal text-fg-secondary"> · {summary}</span> : ""}
        </span>
        <span className="block truncate text-[11.5px] text-fg-muted">
          {streaming
            ? <span className="text-shine">driving Chromium…</span>
            : errorText || result?.error || result?.message || pageTitle || "recorded to timeline"}
        </span>
      </span>
      <span className="flex shrink-0 translate-x-1 items-center gap-1 text-[12px] text-accent opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
        Watch <ArrowUpRight size={13} />
      </span>
    </button>
  );
}

/**
 * Generic tool row, marked the way DeepSeek Harness marks tool calls.
 *
 * dsh classifies every call into a variant (search | read | bash | write |
 * edit | code | others) with variant icon/title, a lifecycle state
 * (preparing | running | ok | error | stopped), a one-line summary derived
 * from the arguments, and an expandable input/output body. MCP-namespaced
 * tools (`server__tool`) additionally show their server. This is that system,
 * adapted to our tool names — no more blanket "MCP" badge on everything.
 *
 * The row geometry is dsh's too: a flat 24px line (no card border, no fill)
 * whose leading icon crossfades into a chevron on hover, with the summary
 * ellipsized into the space that remains to its right — not pushed to the far
 * edge as a monospace tail. Shell results render through `TerminalBlock`
 * rather than as a JSON dump.
 */
type ToolVariant = "search" | "read" | "bash" | "write" | "edit" | "code" | "others";
type ToolState = "preparing" | "running" | "ok" | "error" | "stopped";

const VARIANT_ICON: Record<ToolVariant, React.ReactNode> = {
  search: <Search size={14} />,
  read: <FileText size={14} />,
  bash: <SquareTerminal size={14} />,
  write: <FilePlus size={14} />,
  edit: <Pencil size={14} />,
  code: <FileCode2 size={14} />,
  others: <Boxes size={14} />,
};

/**
 * Tool names, titles and variants come from the shared catalog
 * (`lib/agent/catalog.ts`), so the server's policy and this card always
 * describe a tool the same way.
 */

/**
 * The real logo for a tool row when one fits — the MCP server's brand, bash for shell calls, the language of the
 * file being read or written, Neo4j-style graph queries — else the variant glyph.
 */
function toolLogo(classified: { variant: ToolVariant; server?: string; tool: string }, args?: Record<string, any>) {
  if (classified.server) return connectorIconKey(classified.server, classified.tool);
  if (classified.variant === "bash") return "bash";
  if (classified.tool === "run_cypher") return "neo4j";
  const path = typeof args?.path === "string" ? args.path : undefined;
  if (path && (classified.variant === "read" || classified.variant === "write" || classified.variant === "edit")) {
    return languageIconKey(path.split(".").pop());
  }
  return undefined;
}

function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function argSummary(tool: string, args?: Record<string, any>): string {
  if (!args) return "";
  const str = (v: unknown, n = 80) => String(v ?? "").slice(0, n);
  switch (tool) {
    case "ws_list":
      return (args.path as string) || ".";
    case "ws_read":
    case "ws_write":
      return str(args.path);
    case "ws_shell":
      // A shell summary is the command's first line; the terminal card below
      // carries the whole command verbatim, so repeating it here is noise.
      return str(String(args.command ?? "").split("\n")[0]);
    case "ws_todo":
      return [args.op, args.text ?? args.id].filter(Boolean).join(" ").slice(0, 80);
    case "ws_remember":
      return [args.kind, str(args.text, 60)].filter(Boolean).join(": ");
    case "companyBrain":
      return str(args.question, 100);
    case "find_experts":
    case "impact_of_failure":
    case "trace_dependencies":
    case "tickets_for_service":
      return str(args.service);
    case "tickets_blocked_by":
    case "get_decision_context":
      return str(args.topic);
    case "find_people":
      return str(args.name);
    case "shortest_path":
      return args.from_service || args.to_service
        ? `${str(args.from_service, 30)} → ${str(args.to_service, 30)}`
        : "";
    case "create_ticket":
    case "update_ticket":
      return str(args.key ?? args.title);
    case "record_decision":
      return str(args.title);
    case "note_knowledge":
      return args.person && args.service ? `${str(args.person, 30)} → ${str(args.service, 30)}` : "";
    case "remember_fact":
      return [args.subject, args.predicate, args.object].filter(Boolean).join(" ").slice(0, 80);
    default: {
      for (const v of Object.values(args)) {
        if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
      }
      return JSON.stringify(args).slice(0, 80);
    }
  }
}

function classifyToolCall(
  rawName: string,
  args?: Record<string, any>,
): { variant: ToolVariant; title: string; summary: string; server?: string; tool: string } {
  // MCP-namespaced tools (`server__tool`): show the server, classify by the
  // tool suffix.
  const segments = rawName.split("__");
  if (segments.length > 1) {
    const server = segments[0];
    const tool = segments.slice(1).join("__");
    const lower = tool.toLowerCase();
    let variant: ToolVariant = "others";
    if (/search|find|list|query|grep|glob/.test(lower)) variant = "search";
    else if (/read|get|fetch|show|open/.test(lower)) variant = "read";
    else if (/bash|shell|command|exec|terminal/.test(lower)) variant = "bash";
    else if (/write|create|save|store|put/.test(lower)) variant = "write";
    else if (/edit|update|patch|delete|remove/.test(lower)) variant = "edit";
    else if (/code|run|query|sql|cypher/.test(lower)) variant = "code";
    const known = TOOL_CATALOG[tool];
    return {
      variant,
      title: known?.title ?? humanize(tool),
      summary: known ? argSummary(tool, args) : argSummary("__other__", { ...args, tool }),
      server,
      tool,
    };
  }
  const known = TOOL_CATALOG[rawName];
  const title = known?.title ?? humanize(rawName);
  return {
    variant: known?.variant ?? "others",
    title,
    summary: argSummary(rawName, args),
    tool: rawName,
  };
}

/**
 * Flatten a tool result to the text dsh's Output section shows: a string
 * result is already text; an object result is pretty-printed rather than
 * stringified on one line, so a JSON result is readable in the terminal card.
 */
function resultText(result: unknown, errorText?: string): string | null {
  if (errorText) return errorText;
  if (typeof result === "string") return result;
  if (result === undefined || result === null) return null;
  if (typeof result === "object") {
    try {
      return JSON.stringify(result, null, 1);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

/** An interrupted run settles as an error whose text names the interruption. */
function isInterrupted(errorText?: string): boolean {
  return !!errorText && /abort|cancel|stopp?ed|interrupt/i.test(errorText);
}

function ToolRow({
  toolName,
  args,
  result,
  streaming,
  errorText,
}: {
  toolName: string;
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
  errorText?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const classified = React.useMemo(() => classifyToolCall(toolName, args), [toolName, args]);
  const logo = toolLogo(classified, args);

  // The attached workspace root is the shell's working directory, which is
  // what dsh renders in the terminal prompt label.
  const workspaceRoot = useAppStore((s) => {
    const cid = s.activeConversationId;
    return cid ? (s.conversationWorkspaces[cid]?.path ?? undefined) : undefined;
  });

  const terminal = React.useMemo(
    () => terminalCardModel(toolName, args, result, errorText, workspaceRoot),
    [toolName, args, result, errorText, workspaceRoot],
  );

  const state: ToolState = errorText
    ? isInterrupted(errorText)
      ? "stopped"
      : "error"
    : streaming
      ? classified.summary
        ? "running"
        : "preparing"
      : "ok";

  // dsh treats a failing exit status as the terminal card's own error signal
  // even though the call settled ok, so the collapsed row turns red without
  // the reader having to expand it.
  const settledState: ToolState =
    state === "ok" && terminal && terminalFailed(terminal) ? "error" : state;

  const output = React.useMemo(
    () => (terminal ? null : resultText(result, errorText)),
    [terminal, result, errorText],
  );
  const inputRaw = React.useMemo(
    () => (args && Object.keys(args).length > 0 ? JSON.stringify(args, null, 1) : null),
    [args],
  );

  const expandable = settledState !== "preparing" && (inputRaw !== null || output !== null || terminal !== null);
  const open = expanded && expandable;
  const running = settledState === "running" || settledState === "preparing";

  const normalSummary = terminal?.description ?? classified.summary;
  const summaryText = settledState === "error" ? (output?.split("\n")[0] ?? normalSummary) : normalSummary;

  const onToggle = React.useCallback(() => {
    if (expandable) setExpanded((v) => !v);
  }, [expandable]);
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!expandable || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      onToggle();
    },
    [expandable, onToggle],
  );

  const statusLabel =
    settledState === "preparing"
      ? "Preparing"
      : settledState === "running"
        ? "Running"
        : settledState === "error"
          ? "Failed"
          : settledState === "stopped"
            ? "Stopped"
            : null;

  return (
    <div className="my-0.5 animate-fade-in-up" data-variant={classified.variant} data-state={settledState}>
      {statusLabel && <span className="sr-only">{statusLabel}</span>}
      <div
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={expandable ? onToggle : undefined}
        onKeyDown={expandable ? onKeyDown : undefined}
        className={`group -mx-1.5 flex min-w-0 items-center rounded-md px-1.5 text-fg-muted transition-colors hover:text-fg-secondary ${
          expandable ? "cursor-pointer hover:bg-bg-hover" : ""
        } ${open ? "bg-bg-hover" : ""}`}
      >
        {/* Leading: the variant icon, crossfading into a chevron on hover when
            the row opens a body — dsh's affordance, no row fill. */}
        <span className="relative mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
          <span
            className={`inline-flex transition-opacity duration-100 ${
              expandable ? "opacity-100 group-hover:opacity-0" : ""
            }`}
          >
            <BrandIcon name={logo} size={14} fallback={VARIANT_ICON[classified.variant]} />
          </span>
          {expandable && (
            <ChevronDown
              size={14}
              className={`absolute inset-0 m-auto opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 ${open ? "rotate-180" : ""}`}
            />
          )}
        </span>

        <TextShimmer active={running} className="shrink-0 text-[13px] leading-6 text-fg">
          {classified.title}
        </TextShimmer>

        {/* An empty summary drops the separator with it — a row that is only
            its title shows no trailing dot. */}
        {summaryText && (
          <>
            <span aria-hidden className="mx-2 h-[2px] w-[2px] shrink-0 rounded-full bg-fg-muted" />
            <TextShimmer
              active={running}
              className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-6 ${
                settledState === "error"
                  ? "text-danger"
                  : settledState === "stopped"
                    ? "text-warning"
                    : "text-fg-muted"
              }`}
            >
              {summaryText}
            </TextShimmer>
          </>
        )}
        {classified.server && (
          <Badge tone="neutral" className="ml-1.5 shrink-0 font-mono">
            {classified.server}
          </Badge>
        )}
        {running && <span className="live-dot ml-2 !h-1.5 !w-1.5 shrink-0" />}
      </div>

      {open && (
        <div className="mt-1 flex flex-col animate-fade-in-up">
          {terminal ? (
            <TerminalBlock
              command={terminal.command}
              cwd={terminal.cwd}
              output={terminal.output}
              exitCode={terminal.exitCode}
              signal={terminal.signal}
              running={terminal.running}
              maxLines={Number.POSITIVE_INFINITY}
              className="mx-0 my-1 ml-1 rounded-[var(--radius-lg)] border border-border"
            />
          ) : (
            (inputRaw !== null || output !== null) && (
              <div className="mx-0 my-1 ml-1 flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg-surface-100 font-mono text-[12.5px]">
                {inputRaw !== null && (
                  <div className="grid max-h-[150px] grid-cols-[max-content_1fr] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3">
                    <span className="eyebrow sticky top-0 self-start !text-[10px]">Input</span>
                    <span className="min-w-0 break-words whitespace-pre-wrap text-fg-secondary">{inputRaw}</span>
                  </div>
                )}
                {inputRaw !== null && output !== null && <span aria-hidden className="h-px w-full bg-border" />}
                {output !== null && (
                  <div className="grid max-h-[150px] grid-cols-[max-content_1fr] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3">
                    <span className="eyebrow sticky top-0 self-start !text-[10px]">Output</span>
                    <span
                      className={`min-w-0 break-words whitespace-pre-wrap ${
                        settledState === "error" ? "text-danger" : "text-fg-secondary"
                      }`}
                    >
                      {output}
                    </span>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
