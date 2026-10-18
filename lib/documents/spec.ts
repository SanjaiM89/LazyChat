import { z } from "zod";

/** Structured document description the model writes; builders turn it into a real .docx/.pdf/.xlsx. */
export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.number().int().min(1).max(3).default(1), text: z.string() }),
  z.object({
    type: z.literal("paragraph"),
    text: z.string().describe("Supports **bold** and *italic* inline"),
    align: z.enum(["left", "center", "right", "justify"]).optional(),
  }),
  z.object({
    type: z.literal("list"),
    items: z.array(z.string()).describe("Each item supports **bold** and *italic*"),
    ordered: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("table"),
    header: z.array(z.string()).optional(),
    rows: z.array(z.array(z.union([z.string(), z.number()]))),
    caption: z.string().optional(),
  }),
  z.object({ type: z.literal("image"), artifactId: z.string().describe("Id of an existing PNG/JPEG artifact"), width: z.number().optional().describe("Width in points (default 400)") }),
  z.object({ type: z.literal("pagebreak") }),
]);
export type Block = z.infer<typeof blockSchema>;

export const textDocSchema = z.object({
  blocks: z.array(blockSchema).min(1).describe("Document content in order"),
});
export type TextDoc = z.infer<typeof textDocSchema>;

const cell = z.union([z.string(), z.number(), z.boolean(), z.null(), z.object({ formula: z.string().describe("Excel formula without the leading '=', e.g. SUM(B2:B10)") })]);
export const sheetSchema = z.object({
  name: z.string().max(31),
  header: z.array(z.string()).optional(),
  rows: z.array(z.array(cell)),
  columnWidths: z.array(z.number()).optional().describe("Widths in characters"),
  numberFormats: z.record(z.string(), z.string()).optional().describe('Per-column number format keyed by column letter, e.g. {"C":"#,##0.00","D":"0.0%"}'),
});
export const sheetsDocSchema = z.object({ sheets: z.array(sheetSchema).min(1).max(20) });
export type SheetsDoc = z.infer<typeof sheetsDocSchema>;
export type Cell = z.infer<typeof cell>;

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/** Minimal inline markup: **bold**, *italic*. Unbalanced markers are kept as literal text. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true });
    else runs.push({ text: m[2], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text }];
}

export const plainText = (text: string) => parseInline(text).map((r) => r.text).join("");
