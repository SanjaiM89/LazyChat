import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { parseInline, type Block, type Run } from "./spec";
import type { ImageResolver } from "./docx";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

const REPLACE: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "→": "->", "←": "<-",
  "≥": ">=", "≤": "<=", "≠": "!=", " ": " ", "−": "-", "✓": "v", "✔": "v", "✗": "x", "•": "•",
};
/** The standard PDF fonts only encode WinAnsi; map common typography and replace the rest. Use docx for other scripts. */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text.replace(/\t/g, "    ")) {
    const c = ch.codePointAt(0)!;
    if (ch === "\n") out += ch;
    else if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    else if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || c === 0x20ac || c === 0x2022) out += ch;
    else out += "?";
  }
  return out;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}
const pick = (f: Fonts, r: Run, forceBold = false) => (r.bold || forceBold ? (r.italic ? f.boldItalic : f.bold) : r.italic ? f.italic : f.regular);

interface Word {
  text: string;
  font: PDFFont;
  width: number;
}

function layoutLines(runs: Run[], fonts: Fonts, size: number, maxWidth: number, forceBold = false): Word[][] {
  const lines: Word[][] = [[]];
  let x = 0;
  for (const run of runs) {
    const font = pick(fonts, run, forceBold);
    // Split into words but keep explicit newlines.
    for (const part of toWinAnsi(run.text).split(/(\n)/)) {
      if (part === "\n") {
        lines.push([]);
        x = 0;
        continue;
      }
      for (const tok of part.split(/(\s+)/).filter((t) => t.length)) {
        const width = font.widthOfTextAtSize(tok, size);
        const isSpace = /^\s+$/.test(tok);
        if (!isSpace && x + width > maxWidth && lines[lines.length - 1].length) {
          lines.push([]);
          x = 0;
        }
        if (isSpace && x === 0) continue; // no leading spaces on a wrapped line
        lines[lines.length - 1].push({ text: tok, font, width });
        x += width;
      }
    }
  }
  return lines;
}

export async function buildPdf(title: string, blocks: Block[], resolveImage?: ImageResolver): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("Omnia");
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };
  const ensure = (h: number) => {
    if (y - h < MARGIN) newPage();
  };

  const drawLines = (lines: Word[][], size: number, leading: number, x0: number, maxWidth: number, align: "left" | "center" | "right" = "left", color = rgb(0.1, 0.1, 0.1)) => {
    for (const line of lines) {
      ensure(leading);
      const width = line.reduce((s, w) => s + w.width, 0);
      let x = align === "center" ? x0 + (maxWidth - width) / 2 : align === "right" ? x0 + maxWidth - width : x0;
      y -= leading;
      for (const w of line) {
        if (w.text.trim()) page.drawText(w.text, { x, y: y + (leading - size) * 0.3, size, font: w.font, color });
        x += w.width;
      }
    }
  };

  // Title
  drawLines(layoutLines([{ text: title }], fonts, 22, CONTENT_W, true), 22, 28, MARGIN, CONTENT_W);
  y -= 10;

  for (const b of blocks) {
    switch (b.type) {
      case "heading": {
        const size = [18, 14, 12][b.level - 1];
        y -= b.level === 1 ? 10 : 6;
        ensure(size * 2.4);
        drawLines(layoutLines([{ text: b.text }], fonts, size, CONTENT_W, true), size, size * 1.35, MARGIN, CONTENT_W);
        y -= 3;
        break;
      }
      case "paragraph":
        drawLines(layoutLines(parseInline(b.text), fonts, 11, CONTENT_W), 11, 15, MARGIN, CONTENT_W, b.align === "center" || b.align === "right" ? b.align : "left");
        y -= 6;
        break;
      case "list": {
        b.items.forEach((item, i) => {
          const marker = b.ordered ? `${i + 1}.` : "•";
          const lines = layoutLines(parseInline(item), fonts, 11, CONTENT_W - 20);
          ensure(15);
          page.drawText(marker, { x: MARGIN + 4, y: y - 15 + 4.5, size: 11, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
          drawLines(lines, 11, 15, MARGIN + 20, CONTENT_W - 20);
        });
        y -= 6;
        break;
      }
      case "table": {
        const cols = Math.max(b.header?.length ?? 0, ...b.rows.map((r) => r.length), 1);
        const colW = CONTENT_W / cols;
        const size = 9.5;
        const lead = 12.5;
        const pad = 4;
        const drawRow = (cells: (string | number)[], head: boolean) => {
          const laid = Array.from({ length: cols }, (_, i) => layoutLines([{ text: String(cells[i] ?? "") }], fonts, size, colW - pad * 2, head));
          const h = Math.max(...laid.map((l) => l.length)) * lead + pad * 2;
          if (y - h < MARGIN) {
            newPage();
            // Keep long tables readable: repeat the header on each new page.
            if (!head && b.header) drawRow(b.header, true);
          }
          if (head) page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, color: rgb(0.93, 0.93, 0.93) });
          const top = y;
          laid.forEach((lines, i) => {
            const save = y;
            y = top - pad;
            drawLines(lines, size, lead, MARGIN + i * colW + pad, colW - pad * 2);
            y = save;
          });
          y = top - h;
          page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
        };
        if (b.header) drawRow(b.header, true);
        for (const r of b.rows) drawRow(r, false);
        if (b.caption) {
          y -= 4;
          drawLines(layoutLines([{ text: b.caption, italic: true }], fonts, 9, CONTENT_W), 9, 12, MARGIN, CONTENT_W, "left", rgb(0.35, 0.35, 0.35));
        }
        y -= 10;
        break;
      }
      case "image": {
        const img = resolveImage?.(b.artifactId);
        if (!img) {
          drawLines(layoutLines([{ text: `[image ${b.artifactId} unavailable]`, italic: true }], fonts, 10, CONTENT_W), 10, 14, MARGIN, CONTENT_W);
          break;
        }
        const embedded = img.kind === "png" ? await pdf.embedPng(img.data) : await pdf.embedJpg(img.data);
        const w = Math.min(b.width ?? 400, CONTENT_W);
        const h = (w * img.height) / img.width;
        ensure(h + 8);
        page.drawImage(embedded, { x: MARGIN, y: y - h, width: w, height: h });
        y -= h + 10;
        break;
      }
      case "pagebreak":
        newPage();
        break;
    }
  }

  const total = pdf.getPageCount();
  pdf.getPages().forEach((p, i) => {
    const label = `${i + 1} / ${total}`;
    const w = fonts.regular.widthOfTextAtSize(label, 9);
    p.drawText(label, { x: (PAGE_W - w) / 2, y: 28, size: 9, font: fonts.regular, color: rgb(0.5, 0.5, 0.5) });
  });
  return Buffer.from(await pdf.save());
}
