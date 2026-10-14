/**
 * Terminal-card derivation for Omnia tool calls, ported from DeepSeek Harness
 * (`packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts`).
 *
 * dsh derives a terminal card from the raw tool call and result: a shell call
 * with a command, a recorded working directory, and a settled result becomes a
 * `TerminalBlock`; anything else (errors, malformed args, a call with no
 * result yet) falls back to the generic input/output card. The port carries
 * that split over, including dsh's rule that a failing exit code is the
 * terminal card's own error signal even though the call itself settled `ok`.
 */

/** Props `TerminalBlock` draws, minus the render site's own additions. */
export interface TerminalCardModel {
  command: string;
  cwd?: string | undefined;
  output?: string | undefined;
  exitCode?: number | null | undefined;
  signal?: string | undefined;
  running: boolean;
  /** Collapse the description the row shows instead of its generic summary. */
  description?: string | undefined;
}

/** Tools whose result carries a shell command and an exit status. */
const SHELL_TOOLS = new Set(["ws_shell"]);

/** Pull a scalar out of a tool result without assuming its shape. */
function pickString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : undefined;
}

/** Pull a finite number out of a tool result without assuming its shape. */
function pickNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * The result text a shell result exposes. `ws_shell` answers with
 * `{ exit_code, duration_ms, output }`; a gateway that flattens the result to
 * a bare string is handled too.
 */
function shellOutput(result: unknown): string | undefined {
  const structured = pickString(result, "output");
  if (structured !== undefined) return structured;
  if (typeof result === "string") return result;
  return undefined;
}

/**
 * Derive terminal props for a shell call, or null for the generic path.
 *
 * @param toolName wire tool name.
 * @param args the call's arguments.
 * @param result the settled result, or undefined while the call is running.
 * @param errorText the call's error text; an error never invents an exit status.
 * @param sessionCwd workspace root, so a relative `workdir` resolves.
 */
export function terminalCardModel(
  toolName: string,
  args: Record<string, any> | undefined,
  result: unknown,
  errorText: string | undefined,
  sessionCwd?: string,
): TerminalCardModel | null {
  if (!SHELL_TOOLS.has(toolName)) return null;
  const command = typeof args?.command === "string" ? args.command.trim() : "";
  if (command === "") return null;

  const workdir = typeof args?.workdir === "string" ? args.workdir : undefined;
  const cwd = workdir === undefined ? sessionCwd : workdir === "" ? sessionCwd : workdir;
  const description =
    typeof args?.description === "string" && args.description.trim() !== ""
      ? args.description
      : undefined;

  // Running: the call is on the wire, so there is no output and no status yet.
  if (result === undefined || result === null) {
    return { command, cwd, running: true, description };
  }
  // An errored call keeps the generic path: dsh's bash tool settles an execution
  // failure as an error result with no exit marker, and the error text is the
  // failure's real message.
  if (errorText) return null;

  const output = shellOutput(result);
  if (output === undefined) return null;

  // A shell that was killed mid-run reports a signal instead of an exit code.
  const signalMatch = /^signal:\s*(\S+)/m.exec(output);
  const signal = signalMatch?.[1];
  const body = signal === undefined ? output : output.replace(/^signal:.*\n?/m, "");

  return {
    command,
    cwd,
    output: body,
    exitCode: signal !== undefined ? null : (pickNumber(result, "exit_code") ?? 0),
    signal,
    running: false,
    description,
  };
}

/**
 * True when a settled terminal card reports a failing exit — a non-zero code or
 * a terminating signal.
 *
 * The bash tool settles a failing command as a completed call (`isError` stays
 * false: the exit status is result data), so this is the collapsed row's only
 * failure signal; without it the red exit pill would be visible only after
 * expanding the card.
 */
export function terminalFailed(model: TerminalCardModel): boolean {
  const { exitCode, signal, running } = model;
  return running !== true && ((exitCode !== undefined && exitCode !== 0) || signal !== undefined);
}