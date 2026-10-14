"use client";

/**
 * Shell command terminal surface, ported from DeepSeek Harness
 * (`packages/client/ui-primitives/src/TerminalBlock.tsx`).
 *
 * This is the single largest visual gap between Omnia and dsh: dsh renders a
 * shell result as an actual terminal — run-state dot in a gutter, `$ cwd`
 * prompt, the command verbatim, an exit-status pill, a copy control, and
 * ANSI-colored output — while Omnia printed the tool result as a JSON `<pre>`.
 *
 * Ported verbatim in behavior: the exit status is the card's own error signal
 * (the tool call itself still settles `ok`), the trailing newline of the output
 * is a terminator and not an extra blank row, output that is only escape bytes
 * reads as empty, and the height cap collapses the middle rather than the tail.
 */
import * as React from "react";
import { parseAnsiLines, type AnsiLine } from "./ansi";
import { headTailCap } from "./head-tail-cap";
import { CommandText } from "./CommandText";
import { StateDot, type StateDotState } from "./StateDot";

/** Output lines shown before the height cap collapses the middle. */
export const DEFAULT_TERMINAL_MAX_LINES = 16;

export interface TerminalBlockLabels {
  commandLine: (line: number) => string;
  signal: (signal: string) => string;
  exitCode: (code: number) => string;
  noExitCode: string;
  running: string;
  failed: string;
  done: string;
  copy: string;
  copied: string;
  noOutput: string;
  collapseAria: string;
  collapse: string;
  expandAria: (hidden: number) => string;
  expand: (hidden: number) => string;
}

/** The label set a terminal render site uses; one shared dictionary. */
export const TERMINAL_LABELS: TerminalBlockLabels = {
  commandLine: (line) => `Command line ${line}`,
  signal: (signal) => `Killed: ${signal}`,
  exitCode: (code) => `Exit ${code}`,
  noExitCode: "No exit code",
  running: "Running",
  failed: "Failed",
  done: "Done",
  copy: "Copy",
  copied: "Copied",
  noOutput: "No output",
  collapseAria: "Collapse output",
  collapse: "Collapse",
  expandAria: (hidden) => `Expand ${hidden} hidden lines`,
  expand: (hidden) => `Expand ${hidden} lines`,
};

/**
 * Prompt label for a working directory: `~` for the home directory itself,
 * otherwise the path's last segment (both separators accepted, trailing
 * separators ignored).
 */
function promptLabel(cwd: string, home: string | undefined): string {
  const trimmed = cwd.replace(/[/\\]+$/, "");
  if (home !== undefined && trimmed === home.replace(/[/\\]+$/, "")) return "~";
  const segment = trimmed.split(/[/\\]/).pop();
  return segment === undefined || segment === "" ? cwd : segment;
}

/**
 * Status pill text for a settled command, or undefined when it settled cleanly
 * (exit 0, no signal) and needs no pill.
 */
function statusText(
  exitCode: number | null | undefined,
  signal: string | undefined,
  labels: TerminalBlockLabels,
): string | undefined {
  if (signal !== undefined) return labels.signal(signal);
  if (exitCode === null) return labels.noExitCode;
  if (exitCode !== undefined && exitCode !== 0) return labels.exitCode(exitCode);
  return undefined;
}

/**
 * Run-state indicator: the running chase (the same indicator a running tool
 * row's leading icon uses, so the row and its card never disagree), green for
 * a clean settle, red for a signal or non-zero exit.
 */
function runState(
  running: boolean,
  exitCode: number | null | undefined,
  signal: string | undefined,
  labels: TerminalBlockLabels,
): { state: StateDotState; label: string } {
  if (running) return { state: "ongoing", label: labels.running };
  if (statusText(exitCode, signal, labels) !== undefined) {
    return { state: "error", label: labels.failed };
  }
  return { state: "done", label: labels.done };
}

/** Render one parsed output line; runs without SGR state render as bare text. */
function renderLine(line: AnsiLine) {
  return line.map((span, index) =>
    span.style === undefined ? (
      span.text
    ) : (
      <span key={index} style={span.style}>
        {span.text}
      </span>
    ),
  );
}

export function TerminalBlock({
  command,
  cwd,
  home,
  output,
  exitCode,
  signal,
  running = false,
  maxLines = DEFAULT_TERMINAL_MAX_LINES,
  copyText,
  runStateDot = true,
  className = "",
  labels = TERMINAL_LABELS,
}: {
  command: string;
  cwd?: string | undefined;
  home?: string | undefined;
  output?: string | undefined;
  exitCode?: number | null | undefined;
  signal?: string | undefined;
  running?: boolean | undefined;
  maxLines?: number | undefined;
  copyText?: string | undefined;
  runStateDot?: boolean | undefined;
  className?: string;
  labels?: TerminalBlockLabels;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const text = output ?? "";

  // A command's output ends with a newline; that terminator is not an extra
  // blank line to draw or to count against the height cap. The check runs on
  // the PARSED lines rather than the raw text, because a reset after the final
  // newline (`line\n\x1b[0m`) leaves the string not ending in one while still
  // producing a last line with nothing visible in it.
  const lines = React.useMemo(() => {
    const parsed = parseAnsiLines(text);
    const last = parsed[parsed.length - 1];
    const terminated =
      parsed.length > 1 && last !== undefined && last.every((span) => span.text === "");
    return terminated ? parsed.slice(0, -1) : parsed;
  }, [text]);

  const onToggle = React.useCallback(() => setExpanded((v) => !v), []);

  // The raw output (never the rendered tree) is the copy payload: the prompt
  // line and the status pill are chrome the user did not run.
  const onCopy = React.useCallback(() => {
    const payload = copyText ?? text;
    void navigator.clipboard
      ?.writeText(payload)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  }, [copyText, text]);

  const status = statusText(exitCode, signal, labels);
  const state = runState(running, exitCode, signal, labels);

  // A multi-line command gets one prompt row per line, so a two-command shell
  // snippet reads as the two commands it is instead of collapsing into one
  // ellipsized row. A trailing newline is a terminator, not an empty command.
  const commandLines = React.useMemo(() => {
    const body = command.endsWith("\n") ? command.slice(0, -1) : command;
    return body.split("\n");
  }, [command]);

  // Read emptiness from the parsed lines the card actually renders, not from
  // the raw text: output that is only escapes or control bytes survives
  // `text.trim()` yet parses to nothing visible.
  const empty = lines.every((line) => line.every((span) => span.text.trim() === ""));
  const { hidden, capped, headLines, tailLines } = headTailCap(
    lines.length,
    maxLines,
    expanded,
  );
  // A running command with nothing printed yet is banner-only; once it has
  // printed, the output streams in under the banner as it would in a terminal.
  const body = !running || !empty;

  return (
    <div
      className={`relative overflow-hidden rounded-[var(--radius)] bg-bg-subtle pl-[30px] text-fg ${className}`}
      data-terminal=""
      data-running={running ? "" : undefined}
    >
      <div
        className={`-ml-[30px] flex max-h-[150px] items-start gap-3 overflow-y-auto py-2 pl-[30px] pr-3.5 ${
          body ? "border-b border-border/60" : ""
        }`}
      >
        <div className="flex min-w-0 flex-1 flex-col font-mono">
          {commandLines.map((line, index) => (
            <div key={index} className="relative flex min-w-0 items-baseline gap-2 leading-[18px]">
              {index === 0 && runStateDot && (
                <>
                  <span className="sr-only">{state.label}</span>
                  <StateDot
                    state={state.state}
                    className="absolute left-[calc(-30px+8px)] top-1/2 -translate-y-1/2"
                  />
                </>
              )}
              {/* The cwd labels the CALL, so only its first row carries it — a
                  later line may well run somewhere else (a `cd` in the command
                  is enough). Later rows keep a bare `$` to stay aligned. */}
              <span className="shrink-0 text-fg-muted">
                {index > 0 || cwd === undefined ? "$" : promptLabel(cwd, home)}
              </span>
              <CommandText
                className="text-fg"
                text={line}
                label={labels.commandLine(index + 1)}
              />
            </div>
          ))}
        </div>
        {status !== undefined && (
          <span className="sticky top-0 flex h-[18px] shrink-0 items-center rounded-full bg-bg-hover px-2 text-[12px] leading-[18px] text-danger">
            {status}
          </span>
        )}
        {(copyText !== undefined || (!running && !empty)) && (
          <button
            type="button"
            onClick={onCopy}
            className="sticky top-0 h-[18px] shrink-0 bg-bg-subtle text-[13px] leading-[18px] text-fg-secondary transition-colors hover:text-fg"
          >
            {copied ? labels.copied : labels.copy}
          </button>
        )}
      </div>

      {body &&
        (empty ? (
          <div className="py-3 pr-3.5 font-mono text-fg-muted">{labels.noOutput}</div>
        ) : (
          <div className="max-h-[224px] overflow-auto py-3 pr-3.5 font-mono text-[13px]">
            {(capped ? lines.slice(0, headLines) : lines).map((line, index) => (
              <div key={index} className="min-h-[18px] leading-[18px] [overflow-wrap:anywhere] [white-space:pre]">
                {renderLine(line)}
              </div>
            ))}
            {hidden > 0 && (
              <button
                type="button"
                className="block w-full text-left text-fg-muted transition-colors hover:text-fg-secondary"
                aria-expanded={expanded}
                aria-label={expanded ? labels.collapseAria : labels.expandAria(hidden)}
                onClick={onToggle}
              >
                {expanded ? labels.collapse : labels.expand(hidden)}
              </button>
            )}
            {capped &&
              lines.slice(lines.length - tailLines).map((line, index) => (
                <div key={index} className="min-h-[18px] leading-[18px] [overflow-wrap:anywhere] [white-space:pre]">
                  {renderLine(line)}
                </div>
              ))}
          </div>
        ))}
    </div>
  );
}