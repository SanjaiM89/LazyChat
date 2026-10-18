import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
} from "docx";
import { parseInline, type Block, type Run } from "./spec";

export interface ImageData {
  data: Uint8Array;
  kind: "png" | "jpg";
  width: number;
  height: number;
}
export type ImageResolver = (artifactId: string) => ImageData | null;

const runs = (rs: Run[], size?: number) => rs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, size }));
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as const;
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

export async function buildDocx(title: string, blocks: Block[], resolveImage?: ImageResolver): Promise<Buffer> {
  const children: FileChild[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })] })];

  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        children.push(new Paragraph({ heading: HEADINGS[b.level - 1], children: [new TextRun({ text: b.text })] }));
        break;
      case "paragraph":
        children.push(new Paragraph({ alignment: b.align ? ALIGN[b.align] : undefined, spacing: { after: 120 }, children: runs(parseInline(b.text)) }));
        break;
      case "list":
        for (const item of b.items) {
          children.push(
            new Paragraph({
              numbering: b.ordered ? { reference: "ordered", level: 0 } : undefined,
              bullet: b.ordered ? undefined : { level: 0 },
              children: runs(parseInline(item)),
            }),
          );
        }
        break;
      case "table": {
        const cols = Math.max(b.header?.length ?? 0, ...b.rows.map((r) => r.length), 1);
        const mk = (text: string | number, head: boolean) =>
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ""), bold: head })] })] });
        const rows: TableRow[] = [];
        if (b.header) rows.push(new TableRow({ tableHeader: true, children: Array.from({ length: cols }, (_, i) => mk(b.header![i] ?? "", true)) }));
        for (const r of b.rows) rows.push(new TableRow({ children: Array.from({ length: cols }, (_, i) => mk(r[i] ?? "", false)) }));
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
        if (b.caption) children.push(new Paragraph({ children: [new TextRun({ text: b.caption, italics: true, size: 18 })] }));
        children.push(new Paragraph({ children: [] }));
        break;
      }
      case "image": {
        const img = resolveImage?.(b.artifactId);
        if (!img) {
          children.push(new Paragraph({ children: [new TextRun({ text: `[image ${b.artifactId} unavailable]`, italics: true })] }));
          break;
        }
        const w = Math.min(b.width ?? 400, 560);
        children.push(
          new Paragraph({
            children: [new ImageRun({ type: img.kind, data: img.data, transformation: { width: w, height: Math.round((w * img.height) / img.width) } })],
          }),
        );
        break;
      }
      case "pagebreak":
        children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
        break;
    }
  }

  const doc = new Document({
    creator: "Omnia",
    title,
    numbering: {
      config: [
        {
          reference: "ordered",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
