/**
 * ANSI terminal output parsing, ported from DeepSeek Harness
 * (`packages/client/ui-primitives/src/ansi.ts`).
 *
 * Shell output arrives full of escape sequences: color, cursor movement, window
 * titles. React renders them as literal garbage unless they are consumed here.
 * The parse resolves each run's colors onto Omnia theme tokens (dsh resolves
 * them onto `--dsw-*`), so colored output adapts to light and dark instead of
 * carrying anser's literal black-on-black palette.
 */
import Anser from "anser";
import type { CSSProperties } from "react";

/**
 * The subset of one anser JSON chunk this module reads. anser's own types
 * declare `fg`/`bg` as `string`, but its parser leaves them `null` for a run
 * that sets no color, so the null is spelled out here.
 */
interface AnsiChunk {
  /** Run text with its SGR codes already removed. */
  content: string;
  /** Foreground as an `r, g, b` triple, or null when the run sets none. */
  fg: string | null;
  /** Background as an `r, g, b` triple, or null when the run sets none. */
  bg: string | null;
  /** SGR attributes in effect for the run, in the order they were declared. */
  decorations: readonly string[];
}

/** One run of terminal text; `style` is undefined for text carrying no SGR state. */
export interface AnsiSpan {
  /** The run's plain text, free of escape sequences and newlines. */
  text: string;
  /** Resolved inline style, or undefined when the run needs no wrapper. */
  style: CSSProperties | undefined;
}

/** The spans of one output line, in order. */
export type AnsiLine = readonly AnsiSpan[];

/**
 * The 8/16 basic ANSI colors, keyed by the whitespace-free `r,g,b` triple
 * anser emits for them, mapped onto Omnia's theme tokens. Black and white both
 * resolve to the primary text color so output stays legible under either theme
 * instead of matching the surface it sits on; bright black takes the muted role.
 * Cyan and magenta have no Omnia equivalent and fall through to anser's literal
 * rgb, as do all 256-palette and truecolor values.
 */
const TOKEN_BY_BASIC_RGB: Record<string, string> = {
  "0,0,0": "var(--color-fg)",
  "255,255,255": "var(--color-fg)",
  "85,85,85": "var(--color-fg-muted)",
  "187,0,0": "var(--color-danger)",
  "255,85,85": "var(--color-danger)",
  "0,187,0": "var(--color-success)",
  "0,255,0": "var(--color-success)",
  "187,187,0": "var(--color-warning)",
  "255,255,85": "var(--color-warning)",
  "0,0,187": "var(--color-info)",
  "85,85,255": "#5585ff",
  "0,187,187": "#00bbbb",
  "85,255,255": "#55ffff",
};

/**
 * CSS for each SGR attribute anser reports. `blink` is deliberately absent —
 * animated text is not reproduced. `reverse` never arrives here: anser consumes
 * it by swapping the run's foreground and background. Underline and
 * strikethrough share `textDecoration`, so in a run declaring both the later
 * declaration wins.
 */
const STYLE_BY_DECORATION: Record<string, CSSProperties | undefined> = {
  bold: { fontWeight: 700 },
  dim: { opacity: 0.7 },
  italic: { fontStyle: "italic" },
  underline: { textDecoration: "underline" },
  strikethrough: { textDecoration: "line-through" },
  hidden: { visibility: "hidden" },
};

/** OSC strings (window title, hyperlinks), with or without their terminator. */
const OSC_SEQUENCE = /\u001b\][^\u001b]*(?:|\u001b\\)?/g;

/** Escape sequences other than CSI: charset selection, single-shift, reset. */
const NON_CSI_ESCAPE = /\u001b(?!\[)[\u0020-\u002f]*[\u0030-\u007e]?/g;

/**
 * C0 controls with no display meaning here. Tab, newline, backspace and ESC
 * survive: the first two for layout, backspace for the overwrite replay, ESC
 * for anser's CSI split.
 */
const INERT_CONTROL = /[\u0000-\u0007\u000b-\u001a\u001c-\u001f\u007f]/g;

/**
 * Replay the cursor movements that rewrite a line in place — the carriage
 * return and backspace a progress bar emits on every frame.
 *
 * dsh keeps a full column buffer with wide-character and combining-mark
 * handling; this reproduces the two movements that carry actual shell output
 * (`\r` overwrites from column zero, `\b` steps back one column) and leaves
 * erase-in-line and absolute cursor addressing alone, since neither appears in
 * the non-interactive `bash -lc` output this card renders.
 */
function applyCursorMovements(text: string): string {
  if (!/[\r\b]/.test(text)) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!/[\r\b]/.test(line)) return line;
      let buffer = "";
      for (const char of line) {
        if (char === "\r") buffer = "";
        else if (char === "\b") buffer = buffer.slice(0, -1);
        else buffer += char;
      }
      return buffer;
    })
    .join("\n");
}

/**
 * Remove every escape sequence and control character that carries no color,
 * leaving CSI sequences for anser and `\n`/`\t` for layout. Cursor movements
 * replay first, since their effect on the visible text must land before the
 * characters that expressed them are dropped.
 */
function sanitize(text: string): string {
  const escaped = text.replace(OSC_SEQUENCE, "").replace(NON_CSI_ESCAPE, "");
  return applyCursorMovements(escaped).replace(INERT_CONTROL, "");
}

/**
 * Resolve one run's colors and decorations.
 * @returns the run's inline style, or undefined when it carries no SGR state.
 */
function resolveStyle(chunk: AnsiChunk): CSSProperties | undefined {
  const style: CSSProperties = {};
  const background = chunk.bg === null ? undefined : `rgb(${chunk.bg})`;
  if (background !== undefined) style.backgroundColor = background;
  if (chunk.fg !== null) {
    const literal = `rgb(${chunk.fg})`;
    // A run that paints its own background keeps anser's literal pair so the
    // authored foreground/background contrast survives; a foreground-only run
    // maps onto a theme token, which adapts to light and dark surfaces.
    style.color =
      background === undefined
        ? TOKEN_BY_BASIC_RGB[chunk.fg.replace(/\s+/g, "")] ?? literal
        : literal;
  }
  for (const decoration of chunk.decorations) {
    Object.assign(style, STYLE_BY_DECORATION[decoration]);
  }
  return Object.keys(style).length === 0 ? undefined : style;
}

/**
 * Parse command output into styled spans grouped by line.
 * @param text raw output text, which may contain ANSI escape sequences.
 * @returns one entry per output line (always at least one, possibly empty).
 */
export function parseAnsiLines(text: string): AnsiLine[] {
  let current: AnsiSpan[] = [];
  const lines: AnsiSpan[][] = [current];
  for (const chunk of Anser.ansiToJson(sanitize(text), {
    json: true,
    remove_empty: true,
  }) as unknown as AnsiChunk[]) {
    const style = resolveStyle(chunk);
    for (const [index, part] of chunk.content.split("\n").entries()) {
      if (index > 0) {
        current = [];
        lines.push(current);
      }
      if (part !== "") current.push({ text: part, style });
    }
  }
  return lines;
}