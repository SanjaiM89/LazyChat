/**
 * Real document generation: each builder must produce a file that parses back with the content we put in.
 *
 * Run: npx tsx --test tests/unit/documents.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { deflateSync } from "node:zlib";

import { buildDocx } from "@/lib/documents/docx";
import { buildPdf, toWinAnsi } from "@/lib/documents/pdf";
import { buildXlsx } from "@/lib/documents/xlsx";
import { evaluateFormula } from "@/lib/documents/formula";
import { imageInfo } from "@/lib/documents/image";
import { parseInline, sheetsDocSchema, textDocSchema, type Block } from "@/lib/documents/spec";

const blocks: Block[] = [
  { type: "heading", level: 1, text: "Quarterly Report" },
  { type: "paragraph", text: "Revenue grew **12%** while churn fell *slightly*." },
  { type: "list", items: ["First point", "Second point"], ordered: false },
  { type: "list", items: ["Step one", "Step two"], ordered: true },
  { type: "table", header: ["Region", "Sales"], rows: [["EMEA", 420], ["APAC", "310"]], caption: "Figures in $k" },
  { type: "pagebreak" },
  { type: "heading", level: 2, text: "Appendix" },
  { type: "paragraph", text: "Done." },
];

/** A valid 2x3 RGB PNG built by hand. */
function tinyPng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(3, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(3 * (1 + 2 * 3), 0x7f);
  for (let r = 0; r < 3; r++) raw[r * 7] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe("spec helpers", () => {
  it("parses inline bold/italic and keeps stray markers", () => {
    assert.deepEqual(parseInline("a **b** *c* d"), [{ text: "a " }, { text: "b", bold: true }, { text: " " }, { text: "c", italic: true }, { text: " d" }]);
    assert.deepEqual(parseInline("2 * 3 = 6"), [{ text: "2 * 3 = 6" }]);
  });
  it("validates specs", () => {
    assert.ok(textDocSchema.safeParse({ blocks }).success);
    assert.equal(textDocSchema.safeParse({ blocks: [] }).success, false);
    assert.equal(textDocSchema.safeParse({ blocks: [{ type: "heading", level: 9, text: "x" }] }).success, false);
    assert.ok(sheetsDocSchema.safeParse({ sheets: [{ name: "S", rows: [[1, "a", { formula: "SUM(A1:A1)" }, null]] }] }).success);
  });
  it("sniffs image formats and sizes", () => {
    const info = imageInfo(tinyPng());
    assert.deepEqual([info?.kind, info?.width, info?.height], ["png", 2, 3]);
    assert.equal(imageInfo(Buffer.from("nope")), null);
  });
});

describe("docx", () => {
  it("is a valid Word package containing our text, list, table and page break", async () => {
    const buf = await buildDocx("Q3 Report", blocks);
    const zip = await JSZip.loadAsync(buf);
    assert.ok(zip.file("[Content_Types].xml") && zip.file("word/document.xml"));
    const xml = await zip.file("word/document.xml")!.async("string");
    for (const s of ["Q3 Report", "Quarterly Report", "First point", "Step two", "EMEA", "420", "Figures in $k", "Appendix"]) assert.ok(xml.includes(s), s);
    assert.ok(xml.includes("<w:tbl>") && xml.includes("w:pageBreakBefore"));
    assert.match(xml, /<w:b\/>[\s\S]*?12%/); // bold run survived
    assert.ok(buf.length > 2000);
  });

  it("embeds an image when the resolver provides one", async () => {
    const png = imageInfo(tinyPng())!;
    const buf = await buildDocx("Img", [{ type: "image", artifactId: "a1", width: 100 }], (id) => (id === "a1" ? png : null));
    const zip = await JSZip.loadAsync(buf);
    assert.ok(Object.keys(zip.files).some((f) => f.startsWith("word/media/")));
    const missing = await buildDocx("Img", [{ type: "image", artifactId: "zz" }], () => null);
    assert.ok((await (await JSZip.loadAsync(missing)).file("word/document.xml")!.async("string")).includes("unavailable"));
  });
});

describe("pdf", () => {
  async function text(buf: Buffer) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      pages.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return pages;
  }

  it("renders every block as readable text with page numbers and honours page breaks", async () => {
    const pages = await text(await buildPdf("Q3 Report", blocks));
    assert.equal(pages.length, 2);
    const all = pages.join("\n");
    for (const s of ["Q3 Report", "Quarterly Report", "12%", "First point", "Step two", "EMEA", "420", "Figures in $k"]) assert.ok(all.includes(s), s);
    assert.ok(pages[1].includes("Appendix") && !pages[0].includes("Appendix"));
    assert.ok(pages[0].includes("1 / 2") && pages[1].includes("2 / 2"));
  });

  it("wraps long text and flows long tables across pages with a repeated header", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`Row ${i}`, "x ".repeat(40)]);
    const long = "word ".repeat(600);
    const pages = await text(await buildPdf("Long", [{ type: "paragraph", text: long }, { type: "table", header: ["Name", "Notes"], rows }]));
    assert.ok(pages.length >= 4);
    assert.ok(pages.slice(1).filter((p) => p.includes("Name") && p.includes("Notes")).length >= 1, "header repeated");
    assert.ok(pages.join(" ").includes("Row 119"));
  });

  it("maps typography to WinAnsi instead of failing", async () => {
    assert.equal(toWinAnsi("“Hi” — café 中"), '"Hi" - café ?');
    const pages = await text(await buildPdf("Tést", [{ type: "paragraph", text: "“quoted” … 中文 €5" }]));
    assert.ok(pages[0].includes("quoted"));
  });

  it("embeds PNG images", async () => {
    const png = imageInfo(tinyPng())!;
    const withImage = await buildPdf("Img", [{ type: "image", artifactId: "a", width: 120 }], () => png);
    const without = await buildPdf("Img", [{ type: "image", artifactId: "a", width: 120 }], () => null);
    assert.ok(withImage.length > without.length + 40, "image bytes are embedded");
  });
});

describe("formula cache evaluator", () => {
  const grid = (rows: Array<Array<number | string | null | { formula: string }>>) => (c: number, r: number) => rows[r]?.[c] ?? null;
  const g = grid([[1, 2, 3], [4, "5", null], [{ formula: "A1+A2" }, 0, 0]]);
  it("handles arithmetic, precedence, ranges and functions", () => {
    assert.equal(evaluateFormula("1+2*3", g), 7);
    assert.equal(evaluateFormula("(1+2)*3-4/2", g), 7);
    assert.equal(evaluateFormula("2^3^2", g), 512);
    assert.equal(evaluateFormula("-A1+B1", g), 1);
    assert.equal(evaluateFormula("SUM(A1:C2)", g), 15);
    assert.equal(evaluateFormula("AVERAGE(A1:C1)", g), 2);
    assert.equal(evaluateFormula("MAX(A1:A2,10)", g), 10);
    assert.equal(evaluateFormula("ROUND(10/3,2)", g), 3.33);
    assert.equal(evaluateFormula("A3*2", g), 10, "follows other formulas");
  });
  it("returns null for unsupported or broken formulas instead of throwing", () => {
    for (const f of ["VLOOKUP(A1,A1:B2,2)", "1/0", "SUM(", "A1 +", "IF(A1>1,1,2)"]) assert.equal(evaluateFormula(f, g), null, f);
    const cyc = grid([[{ formula: "B1" }, { formula: "A1" }]]);
    assert.equal(evaluateFormula("A1", cyc), null);
  });
});

describe("xlsx", () => {
  it("writes typed cells, live formulas, widths and number formats that read back", () => {
    const buf = buildXlsx({
      sheets: [
        {
          name: "Budget",
          header: ["Item", "Cost", "Paid"],
          rows: [["Rent", 1200.5, true], ["Food", 300, false], ["Total", { formula: "SUM(B2:B3)" }, null]],
          numberFormats: { B: "#,##0.00" },
          columnWidths: [20, 12, 8],
        },
        { name: "Budget", rows: [["dup name"]] },
      ],
    });
    const wb = XLSX.read(buf, { type: "buffer", cellFormula: true, cellNF: true, cellStyles: true });
    assert.deepEqual(wb.SheetNames, ["Budget", "Budget_2"]);
    const ws = wb.Sheets["Budget"];
    assert.equal(ws["A1"].v, "Item");
    assert.equal(ws["B2"].v, 1200.5);
    assert.equal(ws["B2"].z, "#,##0.00");
    assert.equal(ws["C2"].v, true);
    assert.equal(ws["B4"].f, "SUM(B2:B3)");
    assert.equal(ws["B4"].v, 1500.5, "cached value so non-recalculating viewers show the total");
    assert.ok(Math.abs((ws["!cols"]?.[0]?.wch ?? 0) - 20) < 1.5, "column width kept");
  });

  it("sanitizes sheet names", () => {
    const wb = XLSX.read(buildXlsx({ sheets: [{ name: "a/b:c*?[x]", rows: [[1]] }] }), { type: "buffer" });
    assert.equal(wb.SheetNames[0], "a_b_c___x_");
  });
});
