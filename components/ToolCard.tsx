"use client";

import * as React from "react";
import {
  FileText,
  SquareTerminal,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Boxes,
  ArrowUpRight,
  Loader2,
  Download,
  FileImage,
  FileSpreadsheet,
  Presentation,
  FileCode2,
  File,
  FilePlus,
  Monitor,
  Pencil,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import { AskUserCard } from "@/components/AskUserCard";
import { TerminalBlock } from "@/components/dsh/TerminalBlock";
import { terminalCardModel, terminalFailed } from "@/components/dsh/terminal-card-model";
import { TextShimmer } from "@/components/dsh/TextShimmer";


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
  if (toolName === "webSearch") {
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
  if (toolName === "createArtifact") {
    return <ArtifactCard args={args} result={result} streaming={streaming} />;
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

function ArtifactCard({
  args,
  result,
  streaming,
}: {
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
}) {
  const openArtifact = useAppStore((s) => s.openArtifact);

  if (streaming) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-bg-elevated px-4 py-3 mb-2 animate-fade-in-up">
        <Sparkles size={15} className="text-accent animate-pulse" />
        <span className="text-[13px] text-fg-secondary font-medium">
          Creating artifact…
        </span>
      </div>
    );
  }

  const artifactId = result?.artifactId;
  const title = result?.title || args?.title || "Artifact";
  const type = result?.type || args?.type || "text";

  return (
    <button
      onClick={() => artifactId && openArtifact(artifactId)}
      className="group flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-4 py-3 mb-2 w-full text-left hover:border-accent/40 hover:bg-bg-hover transition-all animate-fade-in-up"
    >
      <span className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
        <FileText size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-fg truncate">{title}</span>
        <span className="text-[12px] text-fg-muted capitalize">{type} artifact</span>
      </span>
      <span className="flex items-center gap-1.5 text-[12px] text-accent opacity-0 group-hover:opacity-100 transition-opacity">
        Open <ArrowUpRight size={13} />
      </span>
    </button>
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
    <div className="rounded-xl border border-border bg-bg-elevated mb-2 overflow-hidden animate-fade-in-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors"
      >
        <span className="w-8 h-8 rounded-lg bg-info-soft text-info flex items-center justify-center shrink-0">
          {streaming ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <SquareTerminal size={15} />
          )}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-[14px] font-medium text-fg truncate">
            {args?.task?.slice(0, 90) || "Agent task"}
          </span>
          <span className="text-[12px] text-fg-muted">
            Docker sandbox · {status}
            {status === "done" && files.length > 0 ? ` · ${files.length} file(s)` : ""}
          </span>
        </span>
        {expanded ? <ChevronUp size={15} className="text-fg-muted" /> : <ChevronDown size={15} className="text-fg-muted" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {errorText && (
            <p className="text-[12.5px] text-danger bg-danger-soft/50 border border-danger/20 rounded-lg px-2.5 py-2">
              {errorText}
            </p>
          )}
          {typeof progress === "number" && progress < 100 && (
            <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
              <div
                className="h-full bg-info rounded-full transition-all"
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
            <div className="border-t border-border/70 pt-2 mt-1">
              <p className="text-[11px] uppercase tracking-wide text-fg-muted/80 font-semibold mb-1.5">
                Produced files
              </p>
              <div className="space-y-1.5">
                {files.map((f: any, i: number) => {
                  const Icon = fileTypeIcon(f.type || f.name);
                  return (
                    <div
                      key={i}
                      className="group flex items-center gap-3 rounded-xl border border-border bg-bg-subtle/50 px-3 py-2 hover:border-accent/40 hover:bg-bg-hover transition-colors"
                    >
                      <span className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
                        <Icon size={15} />
                      </span>
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
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[12px] text-fg-secondary hover:text-accent hover:border-accent/40 transition-colors"
                          title="Open file"
                        >
                          <ArrowUpRight size={12} />
                          Open
                        </a>
                        <a
                          href={f.url}
                          download
                          className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg border border-border text-fg-muted hover:text-accent hover:border-accent/40 transition-colors"
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
            className="text-[12px] text-info hover:underline underline-offset-2 inline-flex items-center gap-1"
          >
            View live run in Agents <ArrowUpRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function fileTypeIcon(typeOrName: string) {
  const t = String(typeOrName || "").toLowerCase();
  if (t.includes("image") || /\.(png|jpe?g|gif|webp)$/.test(t)) return FileImage;
  if (t.includes("xls") || /\.(xlsx?|csv)$/.test(t)) return FileSpreadsheet;
  if (t.includes("pptx") || /\.ppt$/.test(t)) return Presentation;
  if (t.includes("code") || /\.(js|ts|tsx|jsx|py|json|css|html?|svg|xml)$/.test(t)) return FileCode2;
  if (t.includes("pdf") || t.includes("doc") || /\.(pdf|docx?|md|txt)$/.test(t)) return FileText;
  return File;
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
      className="group flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated px-4 py-2.5 mb-2 text-left hover:border-accent/40 hover:bg-bg-hover transition-all animate-fade-in-up"
      title="Open the Chromium panel to watch / take over"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
        {streaming ? <Loader2 size={15} className="animate-spin" /> : <Monitor size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-fg">
          Computer: {action}
          {summary ? <span className="font-normal text-fg-secondary"> · {summary}</span> : ""}
        </span>
        <span className="block truncate text-[11.5px] text-fg-muted">
          {streaming
            ? "driving Chromium…"
            : errorText || result?.error || result?.message || pageTitle || "recorded to timeline"}
        </span>
      </span>
      <span className="flex items-center gap-1 text-[12px] text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
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

/** Tool-owned titles that refine the generic variant (cf. dsh TOOL_TITLE_KEYS). */
const TOOL_TITLES: Record<string, string> = {
  ws_list: "List files",
  ws_read: "Read file",
  ws_write: "Write file",
  ws_shell: "Run command",
  ws_todo: "Todo",
  ws_remember: "Remember",
  companyBrain: "Company Brain",
  find_experts: "Find experts",
  trace_dependencies: "Trace dependencies",
  impact_of_failure: "Blast radius",
  get_decision_context: "Decision context",
  tickets_blocked_by: "Blocked tickets",
  tickets_for_service: "Service tickets",
  find_people: "Find people",
  shortest_path: "Shortest path",
  pagerank: "PageRank",
  bridge_services: "Bridges",
  find_bottlenecks: "Bottlenecks",
  central_services: "Central services",
  team_clusters: "Team clusters",
  graph_context: "Graph context",
  run_cypher: "Run Cypher",
  create_ticket: "Create ticket",
  update_ticket: "Update ticket",
  record_decision: "Record decision",
  note_knowledge: "Note expertise",
  remember_fact: "Remember fact",
};

const VARIANT_BY_TOOL: Record<string, ToolVariant> = {
  ws_list: "read",
  ws_read: "read",
  ws_write: "write",
  ws_shell: "bash",
  ws_todo: "others",
  ws_remember: "others",
  companyBrain: "others",
  find_experts: "others",
  trace_dependencies: "others",
  impact_of_failure: "others",
  get_decision_context: "read",
  tickets_blocked_by: "others",
  tickets_for_service: "search",
  find_people: "search",
  shortest_path: "others",
  pagerank: "others",
  bridge_services: "others",
  find_bottlenecks: "others",
  central_services: "others",
  team_clusters: "others",
  graph_context: "read",
  run_cypher: "code",
  create_ticket: "write",
  update_ticket: "edit",
  record_decision: "write",
  note_knowledge: "write",
  remember_fact: "write",
};

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
  // MCP-namespaced tools (`server__tool`, the dsh convention): show the
  // server, classify by the tool suffix.
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
    return {
      variant,
      title: TOOL_TITLES[tool] ?? humanize(tool),
      summary: TOOL_TITLES[tool] ? argSummary(tool, args) : argSummary("__other__", { ...args, tool }),
      server,
      tool,
    };
  }
  const title = TOOL_TITLES[rawName] ?? humanize(rawName);
  return {
    variant: VARIANT_BY_TOOL[rawName] ?? "others",
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
    <div className="my-1 animate-fade-in-up" data-variant={classified.variant} data-state={settledState}>
      {statusLabel && <span className="sr-only">{statusLabel}</span>}
      <div
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={expandable ? onToggle : undefined}
        onKeyDown={expandable ? onKeyDown : undefined}
        className={`group flex min-w-0 items-center text-fg-muted transition-colors hover:text-fg-secondary ${
          expandable ? "cursor-pointer" : ""
        }`}
      >
        {/* Leading: the variant icon, crossfading into a chevron on hover when
            the row opens a body — dsh's affordance, no row fill. */}
        <span className="relative mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
          <span
            className={`inline-flex transition-opacity duration-100 ${
              expandable ? "opacity-100 group-hover:opacity-0" : ""
            }`}
          >
            {VARIANT_ICON[classified.variant]}
          </span>
          {expandable && (
            <ChevronDown
              size={14}
              className="absolute inset-0 m-auto opacity-0 transition-opacity duration-100 group-hover:opacity-100"
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
          <Badge tone="info" className="ml-1.5 shrink-0">
            {classified.server}
          </Badge>
        )}
      </div>

      {open && (
        <div className="mt-1 flex flex-col">
          {terminal ? (
            <TerminalBlock
              command={terminal.command}
              cwd={terminal.cwd}
              output={terminal.output}
              exitCode={terminal.exitCode}
              signal={terminal.signal}
              running={terminal.running}
              maxLines={Number.POSITIVE_INFINITY}
              className="mx-0 my-1 ml-1 rounded-[var(--radius)] border border-border"
            />
          ) : (
            (inputRaw !== null || output !== null) && (
              <div className="mx-0 my-1 ml-1 flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-bg-subtle font-mono text-[13px]">
                {inputRaw !== null && (
                  <div className="grid max-h-[150px] grid-cols-[max-content_1fr] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3">
                    <span className="sticky top-0 self-start text-[13px] text-fg-muted">Input</span>
                    <span className="min-w-0 break-words whitespace-pre-wrap text-fg-secondary">{inputRaw}</span>
                  </div>
                )}
                {inputRaw !== null && output !== null && <span aria-hidden className="h-px w-full bg-border/60" />}
                {output !== null && (
                  <div className="grid max-h-[150px] grid-cols-[max-content_1fr] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3">
                    <span className="sticky top-0 self-start text-[13px] text-fg-muted">Output</span>
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
