import * as XLSX from "xlsx";
import { evaluateFormula } from "./formula";
import type { Cell, SheetsDoc } from "./spec";

const colLetter = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Build a real workbook: typed cells, live formulas, column widths and number formats. */
export function buildXlsx(doc: SheetsDoc): Buffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sheet of doc.sheets) {
    const ws: XLSX.WorkSheet = {};
    let maxCol = 0;
    const hasHeader = !!sheet.header;
    // Grid lookup for cached formula values (data rows follow the optional header row).
    const lookup = (c: number, r: number): Cell => {
      if (hasHeader && r === 0) return sheet.header![c] ?? null;
      return sheet.rows[r - (hasHeader ? 1 : 0)]?.[c] ?? null;
    };
    const put = (r: number, c: number, v: Cell) => {
      const ref = XLSX.utils.encode_cell({ r, c });
      maxCol = Math.max(maxCol, c);
      if (v === null) return;
      if (typeof v === "object") {
        // The cached value lets non-recalculating viewers show a number; Excel/Sheets recompute on open.
        const cached = evaluateFormula(v.formula, lookup);
        ws[ref] = { t: "n", f: v.formula.replace(/^=/, ""), v: cached ?? 0 };
      }
      else if (typeof v === "number") ws[ref] = { t: "n", v };
      else if (typeof v === "boolean") ws[ref] = { t: "b", v };
      else ws[ref] = { t: "s", v };
    };
    let r = 0;
    if (sheet.header) {
      sheet.header.forEach((h, c) => put(0, c, h));
      r = 1;
    }
    for (const row of sheet.rows) {
      row.forEach((v, c) => put(r, c, v));
      r++;
    }
    for (const [col, fmt] of Object.entries(sheet.numberFormats ?? {})) {
      const c = XLSX.utils.decode_col(col.toUpperCase());
      for (let i = sheet.header ? 1 : 0; i < r; i++) {
        const cellRef = ws[XLSX.utils.encode_cell({ r: i, c })];
        if (cellRef && cellRef.t === "n") cellRef.z = fmt;
      }
    }
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, 0), c: maxCol } });
    const widths =
      sheet.columnWidths ??
      Array.from({ length: maxCol + 1 }, (_, c) =>
        Math.min(
          60,
          Math.max(8, ...[sheet.header?.[c], ...sheet.rows.map((row) => row[c])].map((v) => (typeof v === "object" && v ? 12 : String(v ?? "").length + 2))),
        ),
      );
    ws["!cols"] = widths.map((wch) => ({ wch }));
    if (sheet.header) ws["!freeze"] = { xSplit: 0, ySplit: 1 } as never;

    let name = sheet.name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Sheet";
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.slice(0, 28)}_${n}`;
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  wb.Workbook = { CalcPr: { fullCalcOnLoad: true } } as XLSX.WorkBook["Workbook"];
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export { colLetter };
