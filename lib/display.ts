/* ------------------------------------------------------------------ */
/*  Reading display options — pure data, safe for client bundles.       */
/*  Fonts are system stacks (always available, incl. Times New Roman)   */
/*  plus a few Google Fonts loaded via <link> in app/layout.tsx.        */
/* ------------------------------------------------------------------ */

export interface DisplayFont {
  id: string;
  name: string;
  /** CSS font-family stack */
  stack: string;
}

export const DISPLAY_FONTS: DisplayFont[] = [
  {
    id: "system",
    name: "System default",
    stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`,
  },
  { id: "inter", name: "Inter", stack: `"Inter", ui-sans-serif, system-ui, sans-serif` },
  { id: "arial", name: "Arial", stack: `Arial, "Helvetica Neue", Helvetica, sans-serif` },
  {
    id: "helvetica",
    name: "Helvetica Neue",
    stack: `"Helvetica Neue", Helvetica, Arial, sans-serif`,
  },
  { id: "verdana", name: "Verdana", stack: `Verdana, Geneva, sans-serif` },
  { id: "trebuchet", name: "Trebuchet MS", stack: `"Trebuchet MS", Verdana, sans-serif` },
  { id: "georgia", name: "Georgia", stack: `Georgia, "Times New Roman", serif` },
  {
    id: "times",
    name: "Times New Roman",
    stack: `"Times New Roman", Times, Georgia, serif`,
  },
  { id: "garamond", name: "Garamond", stack: `Garamond, "EB Garamond", Georgia, serif` },
  {
    id: "palatino",
    name: "Palatino",
    stack: `"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`,
  },
  {
    id: "merriweather",
    name: "Merriweather",
    stack: `"Merriweather", Georgia, serif`,
  },
  { id: "lora", name: "Lora", stack: `"Lora", Georgia, serif` },
  {
    id: "courier",
    name: "Courier New",
    stack: `"Courier New", Courier, monospace`,
  },
  {
    id: "jetbrains",
    name: "JetBrains Mono",
    stack: `"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`,
  },
];

export interface DisplaySettings {
  /** DISPLAY_FONTS id */
  font: string;
  /** chat reading font size, px */
  fontSize: number;
  /** chat column width, px */
  contentWidth: number;
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  font: "system",
  fontSize: 15,
  contentWidth: 780,
};

export const MIN_FONT_SIZE = 13;
export const MAX_FONT_SIZE = 20;
export const MIN_WIDTH = 560;
export const MAX_WIDTH = 1600;

export function fontStack(id: string): string {
  return DISPLAY_FONTS.find((f) => f.id === id)?.stack ?? DISPLAY_FONTS[0].stack;
}

export function clampDisplay(d: Partial<DisplaySettings>): DisplaySettings {
  return {
    font: DISPLAY_FONTS.some((f) => f.id === d.font) ? (d.font as string) : DEFAULT_DISPLAY.font,
    fontSize: Math.min(
      MAX_FONT_SIZE,
      Math.max(MIN_FONT_SIZE, Math.round(d.fontSize ?? DEFAULT_DISPLAY.fontSize)),
    ),
    contentWidth: Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, Math.round(d.contentWidth ?? DEFAULT_DISPLAY.contentWidth)),
    ),
  };
}
