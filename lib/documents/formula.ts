/**
 * Tiny spreadsheet evaluator used only to store a *cached value* next to each generated formula, so viewers that
 * do not recalculate (our in-app preview, quick-look panes) show numbers rather than 0. Excel/Sheets recompute on
 * open regardless. Supports numbers, cell refs (A1), ranges (A1:B3), + - * / ^, parentheses, unary minus and
 * SUM/AVERAGE/MIN/MAX/COUNT/ROUND/ABS. Anything else returns null (cached value stays unset).
 */
export type Grid = (c: number, r: number) => number | string | boolean | null | { formula: string };

const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function evaluateFormula(formula: string, get: Grid, seen: Set<string> = new Set()): number | null {
  const src = formula.replace(/^=/, "").trim();
  let i = 0;
  const peek = () => src[i];
  const ws = () => {
    while (src[i] === " ") i++;
  };
  const fail: () => never = () => {
    throw new Error("unsupported");
  };

  const cellValue = (c: number, r: number): number => {
    const key = `${c},${r}`;
    if (seen.has(key)) fail();
    const v = get(c, r);
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "object") {
      const n = evaluateFormula(v.formula, get, new Set(seen).add(key));
      if (n === null) fail();
      return n;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0; // text counts as 0 in arithmetic
  };

  const rangeValues = (a: string, b: string): number[] => {
    const [, c1, r1] = a.match(/^([A-Z]+)(\d+)$/i)!;
    const [, c2, r2] = b.match(/^([A-Z]+)(\d+)$/i)!;
    const out: number[] = [];
    for (let r = Math.min(+r1, +r2); r <= Math.max(+r1, +r2); r++)
      for (let c = Math.min(colIndex(c1), colIndex(c2)); c <= Math.max(colIndex(c1), colIndex(c2)); c++) {
        const v = get(c, r - 1);
        if (v === null || v === "" || typeof v === "string") {
          if (typeof v === "string" && Number.isFinite(Number(v)) && v.trim() !== "") out.push(Number(v));
          continue;
        }
        out.push(cellValue(c, r - 1));
      }
    return out;
  };

  function expr(): number {
    let v = term();
    for (ws(); peek() === "+" || peek() === "-"; ws()) {
      const op = src[i++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term(): number {
    let v = power();
    for (ws(); peek() === "*" || peek() === "/"; ws()) {
      const op = src[i++];
      const r = power();
      if (op === "/" && r === 0) fail();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function power(): number {
    const base = unary();
    ws();
    if (peek() === "^") {
      i++;
      return Math.pow(base, power());
    }
    return base;
  }
  function unary(): number {
    ws();
    if (peek() === "-") {
      i++;
      return -unary();
    }
    if (peek() === "+") {
      i++;
      return unary();
    }
    return atom();
  }
  function atom(): number {
    ws();
    if (peek() === "(") {
      i++;
      const v = expr();
      ws();
      if (src[i++] !== ")") fail();
      return v;
    }
    const num = src.slice(i).match(/^\d+(\.\d+)?/);
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const id = src.slice(i).match(/^[A-Za-z]+\d*/);
    if (!id) fail();
    const name = id![0];
    i += name.length;
    if (peek() === "(") {
      i++;
      const args: number[][] = [];
      ws();
      if (peek() !== ")") {
        for (;;) {
          args.push(argument());
          ws();
          if (peek() === ",") {
            i++;
            continue;
          }
          break;
        }
      }
      if (src[i++] !== ")") fail();
      return call(name.toUpperCase(), args);
    }
    if (/^[A-Za-z]+\d+$/.test(name)) return cellValue(colIndex(name.match(/^[A-Za-z]+/)![0]), Number(name.match(/\d+$/)![0]) - 1);
    return fail() as never;
  }
  function argument(): number[] {
    ws();
    const range = src.slice(i).match(/^([A-Za-z]+\d+):([A-Za-z]+\d+)/);
    if (range) {
      i += range[0].length;
      return rangeValues(range[1], range[2]);
    }
    return [expr()];
  }
  function call(fn: string, args: number[][]): number {
    const flat = args.flat();
    switch (fn) {
      case "SUM": return flat.reduce((a, b) => a + b, 0);
      case "AVERAGE": return flat.length ? flat.reduce((a, b) => a + b, 0) / flat.length : fail() as never;
      case "MIN": return flat.length ? Math.min(...flat) : 0;
      case "MAX": return flat.length ? Math.max(...flat) : 0;
      case "COUNT": return flat.length;
      case "ABS": return Math.abs(flat[0] ?? 0);
      case "ROUND": {
        const p = Math.pow(10, args[1]?.[0] ?? 0);
        return Math.round((args[0]?.[0] ?? 0) * p) / p;
      }
      default: return fail() as never;
    }
  }

  try {
    const v = expr();
    ws();
    return i === src.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
