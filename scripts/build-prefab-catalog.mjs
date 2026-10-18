#!/usr/bin/env node
// Builds lib/genui/catalog.json - every Prefab component (type, summary, props, descriptions) - from the Python
// sources that the official renderer bundle embeds for its in-browser sandbox. The model gets exact prop names
// through the search_ui_components tool, and the validator knows the real component set.
//
//   npm run genui:catalog
import fs from "node:fs";
import path from "node:path";

const pkgDir = path.resolve("node_modules/@prefecthq/prefab-ui");
const appDir = path.join(pkgDir, "dist", "app");
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;

const bundle = fs.readdirSync(appDir).filter((f) => f.endsWith(".js")).map((f) => path.join(appDir, f))
  .find((f) => fs.readFileSync(f, "utf8").includes('"prefab_ui/components/card.py":`'));
if (!bundle) throw new Error("Could not find the embedded prefab_ui sources in the renderer bundle");
const src = fs.readFileSync(bundle, "utf8");

// --- 1. extract the embedded Python modules ("prefab_ui/x.py":`...`) -----------------------------------
const BT = String.fromCharCode(96);
const BS = String.fromCharCode(92);
const modules = {};
const keyRe = /"(prefab_ui\/[A-Za-z0-9_/]+\.py)":`/g;
let m;
while ((m = keyRe.exec(src))) {
  let i = keyRe.lastIndex;
  let out = "";
  while (i < src.length) {
    const ch = src[i];
    if (ch === BS) {
      const n = src[i + 1];
      out += n === BS || n === BT || n === "$" ? n : ch + n;
      i += 2;
    } else if (ch === BT) break;
    else {
      out += ch;
      i++;
    }
  }
  modules[m[1]] = out;
  keyRe.lastIndex = i;
}

// --- 2. parse component classes -----------------------------------------------------------------------
function balancedArgs(text, start) {
  // text[start] === "(" ; returns [inner, endIndex]
  let depth = 0;
  let inStr = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === BS) i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return [text.slice(start + 1, i), i];
    }
  }
  return ["", text.length];
}

const firstString = (s) => {
  const mm = s.match(/(?:description\s*=\s*)((?:"(?:[^"\\]|\\.)*"\s*)+|(?:'(?:[^'\\]|\\.)*'\s*)+)/);
  if (!mm) return "";
  return [...mm[1].matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1] ?? x[2]).join("").replace(/\\n/g, " ");
};

const components = {};
const shapes = {};
const camel = (n) => n.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
for (const [file, py] of Object.entries(modules)) {
  if (!file.startsWith("prefab_ui/components/")) continue;
  const classRe = /^class (\w+)\(([^)]*)\):\n/gm;
  const starts = [...py.matchAll(classRe)];
  starts.forEach((cm, idx) => {
    const body = py.slice(cm.index + cm[0].length, idx + 1 < starts.length ? starts[idx + 1].index : py.length);
    const typeM = body.match(/^\s{4}type:\s*Literal\["([A-Za-z0-9]+)"\]/m);
    const doc = (body.match(/^\s{4}"""([\s\S]*?)"""/m) ?? [, ""])[1].trim();
    const summary = doc.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
    const fields = [];
    const lines = body.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const fm = lines[li].match(/^ {4}([a-z_][A-Za-z0-9_]*):\s*([^=\n]+?)(?:\s*=\s*(.*))?$/);
      if (!fm || fm[1] === "type" || fm[1].startsWith("_") || /ClassVar/.test(fm[2]) || /^\s*#/.test(lines[li])) continue;
      let rest = fm[3] ?? "";
      let full = lines[li];
      if (rest.startsWith("Field(")) {
        const joined = lines.slice(li).join("\n");
        const at = joined.indexOf("Field(");
        const [inner] = balancedArgs(joined, at + 5);
        rest = "Field(" + inner + ")";
        full = inner;
      }
      const required = !fm[3] || (/^Field\(\s*\.\.\./.test(rest));
      const dflt = rest.match(/default\s*=\s*([^,)\n]+)/)?.[1];
      fields.push({
        name: camel(fm[1]),
        type: fm[2].trim(),
        required: required && !/\|\s*None/.test(fm[2]),
        description: firstString(full),
        ...(dflt && dflt !== "..." ? { default: dflt.trim() } : {}),
      });
    }
    if (!typeM) {
      // Helper models that appear inside component props (DataTableColumn, ChartSeries, ...).
      if (fields.length && !cm[1].startsWith("_") && !/Enum|Exception|Error/.test(cm[2])) {
        shapes[cm[1]] ??= { name: cm[1], summary: summary.slice(0, 300), fields };
      }
      return;
    }
    if (components[typeM[1]]) return; // first definition wins (charts/ before histogram.py)
    components[typeM[1]] = {
      type: typeM[1],
      module: file.replace("prefab_ui/components/", "").replace(/\.py$/, ""),
      bases: cm[2].split(",").map((b) => b.trim().replace(/\[.*$/, "")).filter(Boolean),
      summary: summary.slice(0, 400),
      container: /children/.test(body) || /Container/.test(cm[2]),
      fields,
    };
  });
}

// Hand-written knowledge verified against the renderer (see scripts/probe-prefab.mjs): control flow serializes
// differently from its Python DSL, and text components use `content`.
components.Condition = {
  type: "Condition",
  module: "control_flow",
  bases: ["Component"],
  summary: "Conditional rendering: the first case whose `when` expression is truthy renders its children, else `else`.",
  container: false,
  fields: [
    { name: "cases", type: "list[{when: str, children: list[Component]}]", required: true, description: "`when` is a raw expression over state, e.g. \"status == 'active'\" or \"count > 3\" (no {{ }})" },
    { name: "else", type: "list[Component] | None", required: false, description: "Rendered when no case matches" },
  ],
};
if (components.ForEach) {
  components.ForEach.summary = "Repeat children for every item of a state list. Inside, use {{ $item.field }} (or {{ $item }}) and {{ $index }}.";
  components.ForEach.fields = [
    { name: "key", type: "str", required: true, description: "State key holding the list to iterate over" },
    { name: "let", type: "dict[str, str] | None", required: false, description: "Extra scoped bindings for the children" },
  ];
}
for (const t of ["Text", "P", "H1", "H2", "H3", "H4", "Heading", "Muted", "Lead", "Large", "Small", "Span", "Label", "BlockQuote", "CardTitle", "CardDescription", "Kbd", "AlertTitle", "AlertDescription"]) {
  const c = components[t];
  if (c && !c.fields.some((f) => f.name === "content")) c.fields.unshift({ name: "content", type: "RxStr", required: false, description: "The text (supports {{ state }} interpolation)" });
}

const out = {
  generatedFrom: `@prefecthq/prefab-ui@${version}`,
  protocolVersion: "0.3",
  count: Object.keys(components).length,
  shapes: Object.values(shapes).sort((a, b) => a.name.localeCompare(b.name)),
  components: Object.values(components).sort((a, b) => a.type.localeCompare(b.type)),
};
fs.mkdirSync("lib/genui", { recursive: true });
fs.writeFileSync("lib/genui/catalog.json", JSON.stringify(out, null, 1) + "\n");
console.log(`catalog: ${out.count} components from ${path.basename(bundle)} (${out.generatedFrom})`);
