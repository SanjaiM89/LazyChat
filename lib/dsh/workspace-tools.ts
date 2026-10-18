/**
 * Native workspace tools: the DeepSeek-style capability set, ported into this
 * app's own agent loop instead of shelled out to the dsh binary.
 *
 * Every tool is confined to one workspace root (symlink/traversal escapes are
 * rejected), streams back through the normal chat tool pipeline, and records
 * durable workspace memory fire-and-forget. The chat UI is untouched — these
 * just appear as tools when a conversation has a workspace attached.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";

import { FalkorClient } from "@/lib/brain/graph";
import { addTodo, listTodos, setTodoStatus, storeShared, writeWorkspaceRecord } from "@/lib/dsh/memory";
import { getWorkspace } from "@/lib/dsh/workspaces";
import {
  openTerminal,
  sendToTerminal,
  readFromTerminal,
  closeTerminal,
  signalTerminal,
  listTerminalSessions,
} from "@/lib/dsh/terminal-sessions";
import { listLspServers, attachLspServer, sendLspRequest, detachLspServer } from "@/lib/dsh/lsp";

/** Max results before we spill the full list to a file. */
const GLOB_MAX = 100;
const GREP_MAX = 250;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** Simple glob: match a relative path against a pattern with * and ** support. */
function matchGlob(pattern: string, relPath: string): boolean {
  // No separator: match basename at any depth.
  const sepIdx = pattern.indexOf("/");
  let basenames: string[];
  if (sepIdx === -1) {
    // Match basename anywhere in the tree.
    const regex = globToRegex(pattern);
    return regex.test(path.basename(relPath));
  }
  const regex = globToRegex(pattern);
  return regex.test(relPath);
}

function globToRegex(pattern: string): RegExp {
  let result = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** — match across directories
        result += ".*";
        i++; // skip next *
        // consume optional /
        if (pattern[i + 1] === "/") {
          i++;
        }
      } else {
        result += "[^/]*";
      }
    } else if (c === "?") {
      result += "[^/]";
    } else if (c === "**") {
      result += ".*";
    } else if (/.[.*+^${}()|[\]\\]/.test(c)) {
      result += "\\" + c;
    } else {
      result += c;
    }
  }
  result += "$";
  return new RegExp(result);
}

/** Recursively walk a directory, returning relative paths (posix) for files. */
async function walkFiles(dir: string, base: string, acc: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    const rel = path.posix.relative(base, full.split(path.sep).join("/"));
    if (e.isDirectory()) {
      await walkFiles(full, base, acc);
    } else if (e.isFile()) {
      acc.push(rel);
    }
  }
}

/** Try to use ripgrep for grep; fall back to a node-based search. */
function rgAvailable(): boolean {
  try {
    execFile("rg", ["--version"], { timeout: 2000 }, () => {});
    return true;
  } catch {
    return false;
  }
}

/** Per-workspace current working directory, for the working_directory tool. */
const cwdMap = new Map<string, string>();

function cwdFor(workspaceId: string, root: string): string {
  const cwd = cwdMap.get(workspaceId);
  if (!cwd) return root;
  try {
    resolveIn(root, cwd);
    return cwd;
  } catch {
    cwdMap.delete(workspaceId);
    return root;
  }
}

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
};

/** Parse ripgrep --line-number --no-heading output. */
function parseRgOutput(stdout: string, searchRoot: string, wsRoot: string, max: number): {
  pattern: string;
  count: number;
  truncated: boolean;
  results: Array<{ file: string; matches: Array<{ line: number; text: string }> }>;
} {
  const lines = stdout.split("\n").filter(Boolean);
  let total = 0;
  const byFile = new Map<string, Array<{ line: number; text: string }>>();
  for (const line of lines) {
    if (total >= max) break;
    // ripgrep format: file:line-number:matched-text
    const colonIdx1 = line.indexOf(":");
    const colonIdx2 = line.indexOf(":", colonIdx1 + 1);
    if (colonIdx1 === -1 || colonIdx2 === -1) continue;
    const filePath = line.slice(0, colonIdx1);
    const lineNum = parseInt(line.slice(colonIdx1 + 1, colonIdx2), 10);
    const text = line.slice(colonIdx2 + 1);
    const relFile = path.relative(wsRoot, filePath);
    const existing = byFile.get(relFile) || [];
    existing.push({ line: lineNum, text: truncate(text, 300) });
    byFile.set(relFile, existing);
    total++;
  }
  return {
    pattern: "",
    count: total,
    truncated: total >= max,
    results: Array.from(byFile.entries()).map(([file, matches]) => ({ file, matches })),
  };
}

/** Resolve `rel` inside `root`, rejecting escapes (.., absolute, symlinks out). */
export function resolveIn(root: string, rel: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, rel || ".");
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Path escapes the workspace: ${rel}`);
  }
  // Resolve symlinks and re-check: a link inside the root may point outside.
  let real = target;
  try {
    real = fs.realpathSync(target);
  } catch {
    // Missing path: check the nearest existing ancestor instead.
    let probe = target;
    for (;;) {
      probe = path.dirname(probe);
      try {
        const anchor = fs.realpathSync(probe);
        real = path.join(anchor, path.relative(probe, target));
        break;
      } catch {
        if (probe === base || probe === path.dirname(probe)) {
          real = target;
          break;
        }
      }
    }
  }
  if (real !== base && !real.startsWith(base + path.sep)) {
    throw new Error(`Path escapes the workspace: ${rel}`);
  }
  return target;
}

function truncate(text: string, max = 12000): string {
  if (text.length <= max) return text;
  return text.slice(0, 6000) + `\n… [${text.length - max} chars cut] …\n` + text.slice(-6000);
}

async function brain(): Promise<FalkorClient | null> {
  try {
    return await FalkorClient.get();
  } catch {
    return null;
  }
}

export interface WorkspaceToolCtx {
  workspaceId: string;
  root: string;
  sessionId?: string;
}

export function buildWorkspaceTools(ctx: WorkspaceToolCtx) {
  const { workspaceId, root } = ctx;

  const remember = (kind: "command" | "change" | "error", data: Record<string, unknown>) => {
    void (async () => {
      try {
        const c = await brain();
        if (c) await writeWorkspaceRecord(c, workspaceId, kind, data);
      } catch {
        // memory must never fail a tool call
      }
    })();
  };

  return {
    ws_list: tool({
      description: `List files in the attached workspace folder (relative paths, directories first). Use to explore the project before reading or editing. Confined to the workspace root.`,
      inputSchema: z.object({ path: z.string().default("").describe("Workspace-relative directory, '' for root") }),
      execute: async ({ path: rel }) => {
        const target = resolveIn(root, rel);
        const names = fs.readdirSync(target);
        const out: Array<{ name: string; dir: boolean; size?: number }> = [];
        for (const name of names.slice(0, 300)) {
          if (name === ".git" || name === "node_modules") continue;
          try {
            const st = fs.statSync(path.join(target, name));
            out.push({ name, dir: st.isDirectory(), size: st.isDirectory() ? undefined : st.size });
          } catch {
            // skip unreadable
          }
        }
        out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
        return { path: rel || ".", entries: out };
      },
    }),

    ws_read: tool({
      description: `Read a file in the attached workspace (workspace-relative path). Returns text up to ~20k chars. Confined to the workspace root.`,
      inputSchema: z.object({ path: z.string().describe("Workspace-relative file path") }),
      execute: async ({ path: rel }) => {
        const target = resolveIn(root, rel);
        const st = fs.statSync(target);
        if (!st.isFile()) throw new Error(`Not a file: ${rel}`);
        if (st.size > 2_000_000) throw new Error(`File too large (${st.size} bytes): ${rel}`);
        return { path: rel, size: st.size, content: fs.readFileSync(target, "utf8").slice(0, 20000) };
      },
    }),

    ws_write: tool({
      description: `Write (create or overwrite) a file in the attached workspace. Parent directories are created. Confined to the workspace root. Prefer editing via shell for partial changes.`,
      inputSchema: z.object({
        path: z.string().describe("Workspace-relative file path"),
        content: z.string().describe("Full file content"),
      }),
      execute: async ({ path: rel, content }) => {
        const target = resolveIn(root, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, "utf8");
        remember("change", { files: [rel], summary: `Wrote ${rel} (${content.length} chars)` });
        return { path: rel, bytes: content.length };
      },
    }),

    ws_shell: tool({
      description: `Run a shell command in the workspace's current directory (bash, 120s timeout). Use for builds, tests, git, scripts — anything the task needs executed. Output truncated to ~12k chars. The command and outcome are remembered in workspace memory.`,
      inputSchema: z.object({
        command: z.string().describe("Bash command, e.g. 'npm test' or 'git status --short'"),
        timeout_s: z.number().min(5).max(600).default(120).describe("Timeout in seconds"),
      }),
      execute: async ({ command, timeout_s }) => {
        const started = Date.now();
        const cwd = cwdFor(workspaceId, root);
        const result = await new Promise<{ code: number; out: string }>((resolve) => {
          execFile(
            "bash",
            ["-lc", command],
            { cwd, timeout: (timeout_s || 120) * 1000, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout, stderr) => {
              const out = (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
              resolve({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code as number) : 1) : 0, out });
            },
          );
        });
        const out = truncate(result.out);
        remember("command", {
          command: command.slice(0, 2000),
          output: out.slice(0, 8000),
          exit_code: result.code,
          duration_ms: Date.now() - started,
        });
        return { exit_code: result.code, duration_ms: Date.now() - started, output: out };
      },
    }),

    ws_todo: tool({
      description: `Workspace TODO list: add/list/set. Use for multi-step tasks so progress survives across turns.`,
      inputSchema: z.object({
        op: z.enum(["add", "list", "done", "doing"]).describe("add|list|done|doing"),
        text: z.string().optional().describe("TODO text (for add)"),
        id: z.string().optional().describe("TODO id (for done/doing)"),
      }),
      execute: async ({ op, text, id }) => {
        const c = await brain();
        if (!c) throw new Error("Workspace memory is unavailable (FalkorDB down).");
        if (op === "add") {
          if (!text?.trim()) throw new Error("TODO text is required.");
          return { todo: await addTodo(c, workspaceId, text) };
        }
        if (op === "done" || op === "doing") {
          if (!id) throw new Error("TODO id is required.");
          await setTodoStatus(c, id, op);
          return { id, status: op };
        }
        return { todos: await listTodos(c, workspaceId) };
      },
    }),

    ws_remember: tool({
      description: `Store durable workspace memory: decisions, plans, error fixes, preferences, summaries. Scoped to this workspace (use scope 'global' for cross-workspace knowledge). Secrets are redacted; duplicates merge; same-slot facts replace.`,
      inputSchema: z.object({
        kind: z.enum(["plan", "decision", "error", "preference", "summary", "note"]).describe("What kind of memory"),
        text: z.string().describe("The content (for error: 'error ||| fix')"),
        slot: z.string().optional().describe("Single-value slot, e.g. user.name"),
        scope: z.enum(["workspace", "global"]).default("workspace"),
      }),
      execute: async ({ kind, text, slot, scope }) => {
        const c = await brain();
        if (!c) throw new Error("Workspace memory is unavailable (FalkorDB down).");
        if (kind === "error") {
          const [error, fix] = text.split("|||").map((s) => s.trim());
          const id = await writeWorkspaceRecord(c, workspaceId, "error", { error: error ?? text, fix: fix ?? "" });
          return { id };
        }
        if (kind === "plan" || kind === "decision" || kind === "summary") {
          const title = text.split("\n")[0].slice(0, 120);
          const id = await writeWorkspaceRecord(
            c,
            workspaceId,
            kind,
            kind === "summary" ? { summary: text } : { title, body: text },
          );
          return { id };
        }
        const mem = await storeShared(
          c,
          scope === "global"
            ? { scope: "global", kind: kind === "preference" ? "preference" : "note", text, slot }
            : { scope: `workspace:${workspaceId}`, kind: kind === "preference" ? "preference" : "note", text, slot },
        );
        return { id: mem.id };
      },
    }),

    ws_glob: tool({
      description: `Find files, not directories, whose paths match a glob pattern (e.g. "**/*.ts", "src/**/*.test.js"). A pattern with no "/" matches the basename at any depth. Returns up to ${GLOB_MAX} paths in modification-time order; a larger result reports where the complete list was saved.`,
      inputSchema: z.object({
        pattern: z.string().describe('Glob pattern, e.g. "**/*.ts"'),
        path: z.string().default("").describe("Workspace-relative directory to search in ('' for root)"),
      }),
      execute: async ({ pattern, path: relDir }) => {
        const dir = resolveIn(root, relDir || ".");
        const all: string[] = [];
        await walkFiles(dir, dir, all);
        // Sort by modification time, newest first.
        all.sort((a, b) => {
          try {
            const sa = fs.statSync(path.join(dir, a)).mtimeMs;
            const sb = fs.statSync(path.join(dir, b)).mtimeMs;
            return sb - sa;
          } catch {
            return 0;
          }
        });
        let matches = all.filter((p) => matchGlob(pattern, p));
        const truncated = matches.length > GLOB_MAX;
        if (truncated) {
          const spillPath = path.join(root, ".glob-results-" + Date.now() + ".txt");
          fs.writeFileSync(spillPath, matches.join("\n"), "utf8");
          matches = matches.slice(0, GLOB_MAX);
          return { pattern, count: matches.length, truncated, spillPath: path.relative(root, spillPath), paths: matches };
        }
        return { pattern, count: matches.length, truncated: false, paths: matches };
      },
    }),

    ws_grep: tool({
      description: `Search file contents with a ripgrep regular expression. Returns matching lines with line numbers, grouped by file. Returns up to ${GREP_MAX} matches; a larger result is truncated. Use the \`include\` glob to filter file types (e.g. "*.ts").`,
      inputSchema: z.object({
        pattern: z.string().describe("Regular expression to search for (ripgrep syntax)"),
        path: z.string().default("").describe("File or directory to search (workspace-relative, '' for root)"),
        include: z.string().optional().describe('Optional glob filter, e.g. "*.ts"'),
      }),
      execute: async ({ pattern, path: rel, include }) => {
        const target = resolveIn(root, rel || ".");
        let stat: fs.Stats;
        try {
          stat = fs.statSync(target);
        } catch {
          throw new Error(`No such path: ${rel || "."}`);
        }

        // Try ripgrep first for best performance.
        if (stat.isDirectory() && !include) {
          try {
            const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
              execFile(
                "rg",
                ["--line-number", "--no-heading", "--max-count", "1", pattern, target],
                { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
                (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout, stderr })),
              );
            });
            return parseRgOutput(stdout, target, root, GREP_MAX);
          } catch {
            // fall through to node-based search
          }
        }

        // Node-based fallback.
        const files: string[] = [];
        if (stat.isFile()) {
          files.push(target);
        } else {
          await walkFiles(target, target, files);
        }
        const regex = new RegExp(pattern);
        const results: Array<{ file: string; matches: Array<{ line: number; text: string }> }> = [];
        let total = 0;
        for (const f of files) {
          if (!regex.source) break;
          if (total >= GREP_MAX) break;
          try {
            const st = fs.statSync(f);
            if (st.size > 2_000_000) continue;
            if (include && !matchGlob(include, path.basename(f))) continue;
            const content = fs.readFileSync(f, "utf8");
            const lines = content.split("\n");
            const fileMatches: Array<{ line: number; text: string }> = [];
            for (let i = 0; i < lines.length && total < GREP_MAX; i++) {
              if (regex.test(lines[i])) {
                fileMatches.push({ line: i + 1, text: truncate(lines[i] || "", 300) });
                total++;
              }
            }
            if (fileMatches.length > 0) {
              results.push({ file: path.relative(root, f), matches: fileMatches });
            }
          } catch {
            // skip unreadable
          }
        }
        return { pattern, count: total, truncated: total >= GREP_MAX, results };
      },
    }),

    ws_read_image: tool({
      description: `Read a PNG/JPEG/WebP/GIF/BMP/TIFF image file in the workspace and return it as a base64 data URL. Large images are downscaled automatically; do not attempt to create thumbnails or install image libraries.`,
      inputSchema: z.object({
        path: z.string().describe("Workspace-relative image file path"),
      }),
      execute: async ({ path: rel }) => {
        const target = resolveIn(root, rel);
        const st = fs.statSync(target);
        if (!st.isFile()) throw new Error(`Not a file: ${rel}`);
        if (st.size > IMAGE_MAX_BYTES) throw new Error(`Image too large (${st.size} bytes): ${rel}`);
        const ext = path.extname(target).toLowerCase();
        const mime = IMAGE_MIME[ext];
        if (!mime) throw new Error(`Unsupported image type: ${ext}. Supported: ${Object.keys(IMAGE_MIME).join(", ")}`);
        const buf = fs.readFileSync(target);
        return {
          path: rel,
          mime,
          data: `data:${mime};base64,${buf.toString("base64")}`,
        };
      },
    }),

    ws_str_replace_editor: tool({
      description: `File editor with view, create, str_replace, and insert commands. str_replace does unique literal replacement; include enough context to make old_string unique. insert appends after insert_line (1-based).`,
      inputSchema: z.object({
        command: z.enum(["view", "create", "str_replace", "insert"]).describe("Operation to perform"),
        path: z.string().describe("Workspace-relative file path"),
        file_text: z.string().optional().describe("Content for create"),
        old_str: z.string().optional().describe("Text to replace (str_replace)"),
        new_str: z.string().optional().describe("Replacement text (str_replace)"),
        insert_line: z.number().optional().describe("Line number to insert after (insert)"),
        view_range: z.array(z.number()).length(2).optional().describe("Line range [start, end] for view"),
      }),
      execute: async (args) => {
        const target = resolveIn(root, args.path);
        switch (args.command) {
          case "view": {
            if (!fs.existsSync(target)) throw new Error(`File not found: ${args.path}`);
            const st = fs.statSync(target);
            if (st.isDirectory()) {
              const names = fs.readdirSync(target).filter((n) => !n.startsWith("."));
              return { path: args.path, dir: true, entries: names };
            }
            const allLines = fs.readFileSync(target, "utf8").split("\n");
            if (args.view_range) {
              const [s, e] = args.view_range;
              return { path: args.path, content: allLines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join("\n") };
            }
            return { path: args.path, content: allLines.map((l, i) => `${i + 1}: ${l}`).join("\n") };
          }
          case "create": {
            if (!args.file_text) throw new Error("file_text is required for create");
            if (fs.existsSync(target)) throw new Error(`File already exists: ${args.path}`);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, args.file_text, "utf8");
            remember("change", { files: [args.path], summary: `Created ${args.path}` });
            return { path: args.path, bytes: args.file_text.length };
          }
          case "str_replace": {
            if (!args.old_str) throw new Error("old_str is required for str_replace");
            if (!args.new_str) throw new Error("new_str is required for str_replace");
            const content = fs.readFileSync(target, "utf8");
            const count = content.split(args.old_str).length - 1;
            if (count !== 1) throw new Error(`old_str must match exactly once (found ${count} matches)`);
            const updated = content.replace(args.old_str, args.new_str);
            fs.writeFileSync(target, updated, "utf8");
            remember("change", { files: [args.path], summary: `str_replace in ${args.path}` });
            return { path: args.path, replacements: 1 };
          }
          case "insert": {
            if (!args.new_str) throw new Error("new_str is required for insert");
            if (args.insert_line === undefined) throw new Error("insert_line is required for insert");
            const content = fs.readFileSync(target, "utf8");
            const lines = content.split("\n");
            const idx = Math.max(0, Math.min(args.insert_line, lines.length));
            lines.splice(idx, 0, ...args.new_str.split("\n"));
            fs.writeFileSync(target, lines.join("\n"), "utf8");
            return { path: args.path, inserted_at: idx + 1 };
          }
          default:
            throw new Error(`Unknown command: ${args.command}`);
        }
      },
    }),

    ws_working_directory: tool({
      description: `Show or change the current working directory within the attached workspace. Default returns the root. Pass a workspace-relative path to cd into a subdirectory — subsequent ws_shell calls run from the new directory. Pass "" to reset to root.`,
      inputSchema: z.object({
        path: z.string().default("").describe("Workspace-relative directory to cd into, or empty to reset"),
      }),
      execute: async ({ path: rel }) => {
        if (rel === "") {
          cwdMap.delete(workspaceId);
          return { path: ".", workspace_root: root };
        }
        const target = resolveIn(root, rel);
        const st = fs.statSync(target);
        if (!st.isDirectory()) throw new Error(`Not a directory: ${rel}`);
        cwdMap.set(workspaceId, rel);
        return { path: rel, workspace_root: root };
      },
    }),

    run_code: tool({
      description: `Execute a code snippet (Python or TypeScript) in the attached workspace. The code is written to a temp file and run via the shell. Returns stdout, stderr, and exit code. Use for quick scripts, data processing, testing algorithms — not long-running servers.`,
      inputSchema: z.object({
        code: z.string().describe("Source code to execute"),
        language: z.enum(["python", "typescript", "javascript", "bash"]).describe("Language of the code"),
        timeout_s: z.number().min(5).max(120).default(30).describe("Execution timeout"),
      }),
      execute: async ({ code, language, timeout_s }) => {
        const ext: Record<string, string> = {
          python: ".py",
          typescript: ".ts",
          javascript: ".js",
          bash: ".sh",
        };
        const cwd = cwdFor(workspaceId, root);
        const filename = `code-run-${Date.now()}${ext[language]}`;
        const filepath = path.join(cwd, ".code-runs", filename);
        fs.mkdirSync(path.dirname(filepath), { recursive: true });
        fs.writeFileSync(filepath, code, "utf8");
        let cmd: string;
        switch (language) {
          case "python": cmd = `python3 ${filename}`; break;
          case "typescript": cmd = `npx tsx ${filename}`; break;
          case "javascript": cmd = `node ${filename}`; break;
          case "bash": cmd = `bash ${filename}`; break;
          default: cmd = `cat ${filename}`;
        }
        const result = await new Promise<{ code: number; out: string }>((resolve) => {
          execFile(
            "bash", ["-lc", `cd "${cwd}" && ${cmd}`],
            { cwd, timeout: (timeout_s || 30) * 1000, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout, stderr) => {
              const out = (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
              resolve({ code: err ? (typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : 1) : 0, out });
            },
          );
        });
        const rel = path.relative(root, filepath);
        return {
          language,
          file: rel,
          exit_code: result.code,
          output: truncate(result.out),
        };
      },
    }),

    create_worktree: tool({
      description: `Create a git worktree in a subdirectory of the workspace, linked to a branch (new branch if it doesn't exist). Returns the worktree path. Use for parallel development across branches. Confined to the workspace root.`,
      inputSchema: z.object({
        path: z.string().describe("Workspace-relative directory for the worktree"),
        branch: z.string().describe("Git branch name (new branches are created automatically)"),
        base: z.string().optional().describe("Optional base branch/commit to branch from (default: main)"),
      }),
      execute: async ({ path: rel, branch, base }) => {
        const target = resolveIn(root, rel);
        if (fs.existsSync(target)) throw new Error(`Path already exists: ${rel}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const gitDir = path.join(root, ".git");
        if (!fs.existsSync(gitDir)) throw new Error("Workspace is not a git repository.");
        const args = base
          ? ["worktree", "add", `"${target}"`, branch, base]
          : ["worktree", "add", `"${target}"`, branch];
        try {
          await new Promise<{ code: number; out: string }>((resolve, reject) => {
            execFile(
              "git", args,
              { cwd: root, timeout: 15000, maxBuffer: 1024 * 1024 },
              (err, stdout, stderr) => {
                if (err) reject(new Error(`${(stderr || stdout || "").toString()}`));
                else resolve({ code: 0, out: (stdout || "").toString() });
              },
            );
          });
          return { path: rel, branch, worktree_path: target, message: `Worktree created at ${rel} (branch: ${branch}).` };
        } catch (e: any) {
          throw new Error(`git worktree failed: ${e.message}`);
        }
      },
    }),

    ws_load_deps: tool({
      description: `Detect and install workspace dependencies. Auto-detects the package manager (npm, yarn, pnpm, pip, cargo, go). Returns the install log. Confined to the workspace root; respects cwd.`,
      inputSchema: z.object({
        timeout_s: z.number().min(30).max(600).default(300).describe("Install timeout"),
      }),
      execute: async ({ timeout_s }) => {
        const cwd = cwdFor(workspaceId, root);
        // Detect package manager.
        let cmd: string;
        if (fs.existsSync(path.join(cwd, "package-lock.json"))) {
          cmd = "npm ci";
        } else if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
          cmd = "pnpm install";
        } else if (fs.existsSync(path.join(cwd, "yarn.lock"))) {
          cmd = "yarn install";
        } else if (fs.existsSync(path.join(cwd, "package.json"))) {
          cmd = "npm install";
        } else if (fs.existsSync(path.join(cwd, "requirements.txt"))) {
          cmd = "pip install -r requirements.txt";
        } else if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
          cmd = "cargo build";
        } else if (fs.existsSync(path.join(cwd, "go.mod"))) {
          cmd = "go mod download";
        } else {
          return { error: "No recognized dependency files found in the workspace." };
        }
        const result = await new Promise<{ code: number; out: string }>((resolve) => {
          execFile(
            "bash", ["-lc", `cd "${cwd}" && ${cmd}`],
            { cwd, timeout: (timeout_s || 300) * 1000, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout, stderr) => {
              const out = (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
              resolve({ code: err ? 1 : 0, out });
            },
          );
        });
        remember("command", {
          command: cmd,
          output: truncate(result.out).slice(0, 8000),
          exit_code: result.code,
          duration_ms: Date.now(),
        });
        return { command: cmd, exit_code: result.code, output: truncate(result.out) };
      },
    }),

    ws_terminal_open: tool({
      description: `Open a new persistent terminal session in the workspace. Returns a session id. Subsequent commands should use ws_terminal_send to write to and ws_terminal_read to read from this session.`,
      inputSchema: z.object({
        cwd: z.string().optional().describe("Optional subdirectory to start in (workspace-relative)"),
      }),
      execute: async ({ cwd: rel }) => {
        const sessionCwd = rel ? resolveIn(root, rel) : cwdFor(workspaceId, root);
        const id = openTerminal(sessionCwd);
        // Give the shell a moment to produce its ready prompt.
        await new Promise((r) => setTimeout(r, 300));
        const { output } = readFromTerminal(id, true);
        return { session_id: id, cwd: sessionCwd, ready: output.includes("TERMINAL_READY") };
      },
    }),

    ws_terminal_send: tool({
      description: `Send input to a persistent terminal session. Appends a newline by default. Use ws_terminal_read to get the output.`,
      inputSchema: z.object({
        id: z.string().describe("Session id from ws_terminal_open"),
        input: z.string().describe("Text to send to the terminal (command, keystroke, etc.)"),
        newline: z.boolean().default(true).describe("Append newline to input"),
      }),
      execute: async ({ id, input, newline }) => {
        const ok = sendToTerminal(id, input + (newline ? "\n" : ""));
        if (!ok) return { error: `Terminal session not found: ${id}` };
        return { session_id: id, sent: input };
      },
    }),

    ws_terminal_read: tool({
      description: `Read accumulated output from a persistent terminal session. Clears the buffer by default so subsequent reads only return new output.`,
      inputSchema: z.object({
        id: z.string().describe("Session id from ws_terminal_open"),
        clear: z.boolean().default(true).describe("Clear the buffer after reading"),
        timeout_ms: z.number().min(0).max(10000).default(1000).describe("Optional wait for output before reading"),
      }),
      execute: async ({ id, clear, timeout_ms }) => {
        if (timeout_ms > 0) await new Promise((r) => setTimeout(r, timeout_ms));
        const { output, exited } = readFromTerminal(id, clear);
        if (exited) return { session_id: id, output, exited: true };
        return { session_id: id, output: truncate(output), exited: false };
      },
    }),

    ws_terminal_close: tool({
      description: `Close a persistent terminal session, sending SIGTERM.`,
      inputSchema: z.object({
        id: z.string().describe("Session id from ws_terminal_open"),
        signal: z.string().optional().describe("Signal to send (default SIGTERM)"),
      }),
      execute: async ({ id, signal }) => {
        const ok = closeTerminal(id, signal as NodeJS.Signals | undefined);
        if (!ok) return { error: `Terminal session not found: ${id}` };
        return { session_id: id, closed: true };
      },
    }),

    ws_terminal_list: tool({
      description: `List all open persistent terminal sessions.`,
      inputSchema: z.object({}),
      execute: async () => {
        const sessions = listTerminalSessions();
        return {
          count: sessions.length,
          sessions: sessions.map((s) => ({
            id: s.id,
            cwd: s.cwd,
            age_ms: Date.now() - s.lastActivity,
          })),
        };
      },
    }),

    ws_terminal_signal: tool({
      description: `Send a signal (e.g. SIGINT, SIGKILL) to a persistent terminal session.`,
      inputSchema: z.object({
        id: z.string().describe("Session id from ws_terminal_open"),
        signal: z.string().default("SIGINT").describe("Signal name (SIGINT, SIGTERM, SIGKILL, etc.)"),
      }),
      execute: async ({ id, signal }) => {
        const ok = signalTerminal(id, signal as NodeJS.Signals);
        if (!ok) return { error: `Terminal session not found: ${id}` };
        return { session_id: id, signal_sent: signal };
      },
    }),

    ws_list_commands: tool({
      description: `List available commands in the workspace — npm scripts (from package.json), Makefile targets, and Cargo commands. Helps discover what the project can do.`,
      inputSchema: z.object({}),
      execute: async () => {
        const cwd = cwdFor(workspaceId, root);
        const result: Record<string, string[]> = {};

        // npm/yarn/pnpm scripts
        const pkgPath = path.join(cwd, "package.json");
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            if (pkg.scripts) result["npm scripts"] = Object.keys(pkg.scripts);
          } catch {}
        }

        // Makefile targets
        const mkPath = path.join(cwd, "Makefile");
        if (fs.existsSync(mkPath)) {
          const content = fs.readFileSync(mkPath, "utf8");
          const targets = content
            .split("\n")
            .filter((l) => /^[a-zA-Z0-9_-]+:/.test(l.trim()))
            .map((l) => l.split(":")[0].trim());
          result["make targets"] = targets;
        }

        // Cargo commands
        const cargoToml = path.join(cwd, "Cargo.toml");
        if (fs.existsSync(cargoToml)) {
          result["cargo"] = ["build", "check", "run", "test", "clippy", "fmt"];
        }

        // Dockerfile targets via docker buildx bake (optional)
        const bakePath = path.join(cwd, "docker-bake.hcl");
        if (fs.existsSync(bakePath)) {
          const content = fs.readFileSync(bakePath, "utf8");
          const targets = content
            .split("\n")
            .filter((l) => /^target /.test(l.trim()))
            .map((l) => l.match(/^target "([^"]+)"/)?.[1])
            .filter(Boolean) as string[];
          result["docker bake targets"] = targets;
        }

        return { cwd, commands: result };
      },
    }),

    ws_list_deps: tool({
      description: `List installed workspace dependencies. Reads package-lock.json (or yarn.lock), requirements.txt, Cargo.lock, etc. to produce a compact list of installed packages with versions.`,
      inputSchema: z.object({
        max: z.number().min(1).max(500).default(50).describe("Max packages to return"),
      }),
      execute: async ({ max }) => {
        const cwd = cwdFor(workspaceId, root);
        const result: Record<string, Array<{ name: string; version: string }>> = {};

        // npm/yarn/pnpm from package-lock.json
        const lockPath = path.join(cwd, "package-lock.json");
        if (fs.existsSync(lockPath) && fs.existsSync(path.join(cwd, "package.json"))) {
          try {
            const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
            const deps: Array<{ name: string; version: string }> = [];
            for (const name of Object.keys((lock.packages || {}) as Record<string, any>)) {
              if (name.startsWith("node_modules/")) {
                const ver = (lock.packages as Record<string, any>)[name].version;
                deps.push({ name: name.replace("node_modules/", ""), version: ver });
              }
            }
            result["npm"] = deps.slice(0, max);
          } catch {}
        }

        // Python requirements
        const reqPath = path.join(cwd, "requirements.txt");
        if (fs.existsSync(reqPath)) {
          const lines = fs.readFileSync(reqPath, "utf8").split("\n");
          const deps = lines
            .filter((l) => l.trim() && !l.startsWith("#"))
            .map((l) => {
              const [name, ...rest] = l.trim().split(/[>=<~!]/);
              return { name, version: rest.join("") || "latest" };
            })
            .slice(0, max);
          result["python"] = deps;
        }

        // Cargo.lock
        const cargolock = path.join(cwd, "Cargo.lock");
        if (fs.existsSync(cargolock)) {
          try {
            const { parse } = require("toml");
            const content = fs.readFileSync(cargolock, "utf8");
            const deps: Array<{ name: string; version: string }> = [];
            const toml = parse(content);
            for (const pkg of (toml.package || []) as Array<{ name: string; version: string }>) {
              deps.push({ name: pkg.name, version: pkg.version });
            }
            result["cargo"] = deps.slice(0, max);
          } catch {}
        }

        return { cwd, dependencies: result };
      },
    }),

    ws_workspace_context: tool({
      description: `Load comprehensive workspace context — all manifest files (package.json, Cargo.toml, requirements.txt, go.mod, Dockerfile, etc.) and project structure. Use this when entering a new workspace to understand the project layout.`,
      inputSchema: z.object({}),
      execute: async () => {
        const cwd = cwdFor(workspaceId, root);
        const manifests: Record<string, string> = {};

        const manifestFiles = ["package.json", "Cargo.toml", "requirements.txt", "go.mod", "pyproject.toml", "Dockerfile", "docker-compose.yml", "setup.py", "Gemfile", "pom.xml", "build.gradle", "CMakeLists.txt"];
        for (const file of manifestFiles) {
          const p = path.join(cwd, file);
          if (fs.existsSync(p)) {
            manifests[file] = truncate(fs.readFileSync(p, "utf8"));
          }
        }

        // Workspace structure (top 2 levels)
        const structure: string[] = [];
        const walk = (dir: string, depth: number, max: number): void => {
          if (depth > max) return;
          let entries: string[];
          try {
            entries = fs.readdirSync(dir).filter((e) => !e.startsWith(".") && !e.startsWith("node_modules"));
          } catch {
            return;
          }
          for (const e of entries) {
            const full = path.join(dir, e);
            const rel = path.relative(cwd, full);
            structure.push(rel);
            const st = fs.statSync(full);
            if (st.isDirectory()) walk(full, depth + 1, max);
          }
        };
        walk(cwd, 0, 2);

        return {
          cwd,
          manifests,
          structure: structure.slice(0, 100),
          structure_count: structure.length,
        };
      },
    }),

    ws_lsp_list: tool({
      description: `List all active Language Server Protocol sessions in the workspace.`,
      inputSchema: z.object({}),
      execute: async () => {
        const servers = listLspServers();
        return { count: servers.length, servers };
      },
    }),

    ws_lsp_attach: tool({
      description: `Start a language server for a specific language in the workspace. Supported: typescript, javascript, python, rust, go, json, yaml, bash, docker. Returns a server id for ws_lsp_request.`,
      inputSchema: z.object({
        language: z.string().describe("Language identifier (typescript, python, etc.)"),
      }),
      execute: async ({ language }) => {
        const cwd = cwdFor(workspaceId, root);
        const result = await attachLspServer(language, cwd);
        return result;
      },
    }),

    ws_lsp_request: tool({
      description: `Send a JSON-RPC request to an active language server. Common methods: textDocument/hover, textDocument/definition, textDocument/references, textDocument/completion, workspace/symbols. Pass params as a JSON string.`,
      inputSchema: z.object({
        id: z.string().describe("Server id from ws_lsp_attach"),
        method: z.string().describe("LSP method name (e.g. textDocument/hover)"),
        params: z.string().optional().describe("JSON string of request params"),
      }),
      execute: async ({ id, method, params }) => {
        const result = await sendLspRequest(id, method, params);
        return { id, method, result: truncate(JSON.stringify(result, null, 2)) };
      },
    }),

    ws_lsp_detach: tool({
      description: `Detach and kill a language server session.`,
      inputSchema: z.object({
        id: z.string().describe("Server id from ws_lsp_attach"),
      }),
      execute: async ({ id }) => {
        const ok = await detachLspServer(id);
        if (!ok) return { error: `LSP server not found: ${id}` };
        return { detached: id };
      },
    }),
  };
}

/** Load workspace context (memory briefing) for prompt injection. */
export async function workspaceBriefing(workspaceId: string, maxChars = 4000): Promise<{ briefing: string; root: string; name: string } | null> {
  const c = await brain();
  if (!c) return null;
  const ws = await getWorkspace(c, workspaceId);
  if (!ws) return null;
  const { buildMemoryContext } = await import("@/lib/dsh/memory");
  const ctx = await buildMemoryContext(c, workspaceId, maxChars);
  const head =
    `## Active workspace: ${ws.name}\nWorking directory for all file/shell tools: ${ws.path}\n` +
    (ws.description ? `About: ${ws.description}\n` : "");
  return { briefing: ctx ? `${head}\n${ctx}` : head, root: ws.path, name: ws.name };
}
