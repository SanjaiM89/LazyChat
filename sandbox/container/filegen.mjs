/**
 * File generation helpers for the sandbox agent: PDF, XLSX, DOCX, CSV.
 * All write into a target path (deliverables should live in /workspace/out).
 */
import fs from "node:fs";
import path from "node:path";

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

/* ------------------------------ PDF ------------------------------ */

export async function makePdf({ title, subtitle, sections }, outPath) {
  const PDFDocument = (await import("pdfkit")).default;
  const { Writable } = await import("node:stream");
  const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });

  const chunks = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  doc.pipe(sink);
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#1a1a1a").text(title, { align: "left" });
  if (subtitle) {
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(12).fillColor("#666").text(subtitle);
  }
  doc.moveDown(0.8);

  for (const section of sections || []) {
    if (section.heading) {
      doc.moveDown(0.6);
      doc.font("Helvetica-Bold").fontSize(15).fillColor("#111").text(section.heading);
      doc.moveDown(0.25);
    }
    for (const p of section.paragraphs || []) {
      doc.font("Helvetica").fontSize(11).fillColor("#222").text(p, { lineGap: 4 });
      doc.moveDown(0.35);
    }
    for (const b of section.bullets || []) {
      doc.font("Helvetica").fontSize(11).fillColor("#222").text(`•  ${b}`, { lineGap: 3, indent: 8 });
      doc.moveDown(0.15);
    }
    if (section.code) {
      doc.moveDown(0.2);
      doc.font("Courier").fontSize(9).fillColor("#333").text(section.code, { lineGap: 2, indent: 6 });
      doc.moveDown(0.3);
    }
  }
  doc.end();
  await new Promise((resolve, reject) => {
    sink.on("finish", resolve);
    sink.on("error", reject);
  });
  ensureDir(outPath);
  fs.writeFileSync(outPath, Buffer.concat(chunks));
  return outPath;
}

/* ------------------------------ XLSX ------------------------------ */

export async function makeXlsx(sheets, outPath) {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets || []) {
    const ws = wb.addWorksheet(String(sheet.name || "Sheet").slice(0, 31));
    if (sheet.columns?.length) {
      ws.addRow(sheet.columns);
      ws.getRow(1).font = { bold: true };
    }
    for (const row of sheet.rows || []) {
      ws.addRow(row);
    }
    ws.views = [{ state: "frozen", ySplit: sheet.columns?.length ? 1 : 0 }];
    ws.getRow(1).height = sheet.columns?.length ? 22 : 18;
  }
  ensureDir(outPath);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

/* ------------------------------ DOCX ------------------------------ */

export async function makeDocx({ title, paragraphs }, outPath) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const children = [];
  if (title) {
    children.push(new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 32 })], spacing: { after: 400 } }));
  }
  for (const p of paragraphs || []) {
    const text = String(p);
    const style =
      text.trim().length < 90 && /^#+\s/.test(text.trim())
        ? HeadingLevel.HEADING_2
        : undefined;
    children.push(
      new Paragraph({
        style,
        children: [new TextRun({ text: text.replace(/^#+\s/, ""), size: 24 })],
        spacing: { after: 200 },
      }),
    );
  }
  const doc = new Document({ sections: [{ children }] });
  ensureDir(outPath);
  await Packer.toBuffer(doc).then((buf) => fs.writeFileSync(outPath, buf));
  return outPath;
}

/* ------------------------------ CSV ------------------------------ */

export function makeCsv(rows, outPath) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = (rows || []).map((r) => r.map(esc).join(",")).join("\n");
  ensureDir(outPath);
  fs.writeFileSync(outPath, csv, "utf8");
  return outPath;
}
