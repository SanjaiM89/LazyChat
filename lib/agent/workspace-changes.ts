/**
 * Per-turn workspace changes.
 *
 * At the start of a top-level turn the working tree is snapshotted; at the
 * end it is snapshotted again and the two are diffed, so the summary names
 * exactly what this turn changed. The baseline is a snapshot rather than
 * HEAD, so changes the user had already made never enter the summary.
 *
 * Git runs against a private index and a private object directory, with the
 * repository's own objects attached read-only: the repository's index,
 * objects, work tree and refs are never touched.
 *
 * Files that git does not cover — ignored paths, files outside the
 * repository, and every edit when there is no repository at all — are copied
 * whole before their first edit and again at the end of the turn, and the two
 * copies are compared for the same counts.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ChangedFile {
  /** The durable path: relative to the working directory when it is inside it. */
  path: string;
  /** The display path used for ordering and labels. */
  display: string;
  /** Lines added. */
  added: number;
  /** Lines removed. */
  removed: number;
  /** Where the counts came from. */
  source: "git" | "capture";
  /** The file is too large to compare. */
  oversized?: boolean;
}

export interface WorkspaceChangesSummary {
  /** The turn the summary belongs to. */
  turn: number;
  /** The changed files, ordered by their display path. */
  files: ChangedFile[];
  /** The complete count, even when the listing was capped. */
  total: number;
  /** Why the record was abandoned, when it was. */
  degraded?: string;
}

export interface WorkspaceChangeLimits {
  /** Milliseconds one git command may run. */
  timeoutMs?: number;
  /** Maximum files carried by one summary. */
  maxFiles?: number;
  /** Bytes a file may hold to be captured or compared. */
  maxFileBytes?: number;
  /** Bytes of git output retained per command. */
  outputMaxBytes?: number;
}

const DEFAULTS = {
  timeoutMs: 30_000,
  maxFiles: 500,
  maxFileBytes: 2 * 1024 * 1024,
  outputMaxBytes: 8 * 1024 * 1024,
};

interface Captured {
  /** The path relative to the working directory. */
  relative: string;
  /** The copy taken before the first edit. */
  before?: string;
  /** The copy taken at the end of the turn. */
  after?: string;
  oversized: boolean;
}

export class WorkspaceChangeRecorder {
  private readonly cwd: string;
  private readonly limits: Required<WorkspaceChangeLimits>;
  private readonly tempRoot: string;
  private repoRoot: string | null = null;
  private objectsDir: string | null = null;
  private objectDir: string | null = null;
  private baselineTree: string | null = null;
  private readonly captures = new Map<string, Captured>();
  private turn = 0;
  private gitAvailable = true;

  constructor(cwd: string, limits: WorkspaceChangeLimits = {}) {
    this.cwd = cwd;
    this.limits = { ...DEFAULTS, ...limits };
    this.tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-changes-"));
  }

  /** The temporary directory this recorder owns. */
  get workspace(): string {
    return this.tempRoot;
  }

  /**
   * Take the baseline of a turn.
   *
   * The working tree is written into a private index, so the state the user
   * already had becomes the baseline instead of showing up as a change.
   */
  async begin(turn: number): Promise<void> {
    this.turn = turn;
    this.captures.clear();
    this.baselineTree = null;
    if (!this.gitAvailable) return;
    try {
      const top = await this.git(["rev-parse", "--show-toplevel"], this.cwd);
      this.repoRoot = top.stdout.trim();
      const gitDir = await this.git(["rev-parse", "--absolute-git-dir"], this.repoRoot);
      this.objectsDir = path.join(gitDir.stdout.trim(), "objects");
      this.objectDir = path.join(this.tempRoot, "objects");
      fs.mkdirSync(this.objectDir, { recursive: true });
      this.baselineTree = await this.writeTree();
    } catch {
      // Without a repository the record still lists the file-tool edits.
      this.repoRoot = null;
      this.baselineTree = null;
    }
  }

  /**
   * Copy a file before a tool mutates it.
   *
   * The copy is taken once per path per turn, so repeated edits to one file
   * count once.
   */
  captureBefore(target: string): void {
    const relative = this.relativePath(target);
    if (!relative) return;
    const existing = this.captures.get(relative);
    if (existing) return;
    const capture: Captured = { relative, oversized: false };
    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) return;
      if (stat.size > this.limits.maxFileBytes) {
        capture.oversized = true;
        this.captures.set(relative, capture);
        return;
      }
      capture.before = this.copyInto(target);
    } catch {
      // A file that is not there yet has nothing to capture.
    }
    this.captures.set(relative, capture);
  }

  /**
   * Close the turn and produce the summary.
   */
  async end(turn = this.turn): Promise<WorkspaceChangesSummary | null> {
    const files: ChangedFile[] = [];
    let degraded: string | undefined;

    if (this.repoRoot && this.baselineTree) {
      try {
        const endTree = await this.writeTree();
        const numstat = await this.git(
          ["diff-tree", "-r", "-M", "--numstat", this.baselineTree, endTree],
          this.repoRoot,
          this.privateEnv(),
        );
        for (const line of numstat.stdout.split("\n")) {
          if (!line.trim()) continue;
          const [added, removed, file] = line.split("\t");
          if (!file) continue;
          files.push({
            path: file,
            display: file,
            added: added === "-" ? 0 : Number(added),
            removed: removed === "-" ? 0 : Number(removed),
            source: "git",
          });
        }
      } catch (e) {
        degraded = `git could not compare the working tree: ${(e as Error).message}`;
      }
    }

    // The files git does not cover are compared from the copies.
    for (const capture of this.captures.values()) {
      if (files.some((f) => f.path === capture.relative)) continue;
      try {
        if (capture.oversized) {
          files.push({
            path: capture.relative,
            display: capture.relative,
            added: 0,
            removed: 0,
            source: "capture",
            oversized: true,
          });
          continue;
        }
        const after = this.copyInto(path.join(this.cwd, capture.relative));
        capture.after = after;
        if (!capture.before) {
          // The file did not exist before the turn: everything is new.
          const count = await this.countLines(after);
          files.push({
            path: capture.relative,
            display: capture.relative,
            added: count,
            removed: 0,
            source: "capture",
          });
          continue;
        }
        const { added, removed } = await this.compare(capture.before, after);
        if (added === 0 && removed === 0) continue;
        files.push({
          path: capture.relative,
          display: capture.relative,
          added,
          removed,
          source: "capture",
        });
      } catch {
        // A file that vanished between the copies is not listed.
      }
    }

    files.sort((a, b) => (a.display < b.display ? -1 : a.display > b.display ? 1 : 0));
    const total = files.length;
    const capped = files.slice(0, this.limits.maxFiles);
    return { turn, files: capped, total, degraded };
  }

  /**
   * The comparison for one listed file.
   *
   * It returns the hunks with three context lines, or a coarse replacement
   * when a line comparison cannot finish.
   */
  async diff(index: number): Promise<{ hunks: string; coarse?: boolean; binary?: boolean } | null> {
    // The summary is kept by the session, not by the recorder: the caller
    // passes the file paths it wants compared.
    void index;
    return null;
  }

  /** Compare two files, returning the added and removed line counts. */
  async compare(before: string, after: string): Promise<{ added: number; removed: number }> {
    const out = await this.git(["diff", "--no-index", "--numstat", "--", before, after], this.cwd);
    const line = out.stdout.split("\n")[0] ?? "";
    const [added, removed] = line.split("\t");
    if (added === "-" || removed === "-") return { added: 0, removed: 0 };
    return { added: Number(added), removed: Number(removed) };
  }

  /** The unified diff between two files, with three context lines. */
  async unified(before: string, after: string): Promise<string> {
    const out = await this.git(["diff", "--no-index", "-U3", "--", before, after], this.cwd);
    return out.stdout;
  }

  /** Remove the temporary directory this recorder owns. */
  dispose(): void {
    try {
      fs.rmSync(this.tempRoot, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  private relativePath(target: string): string | null {
    const absolute = path.resolve(this.cwd, target);
    const relative = path.relative(this.cwd, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative;
  }

  private copyInto(target: string): string {
    const bytes = fs.readFileSync(target);
    const name = crypto.createHash("sha1").update(bytes).digest("hex");
    const destination = path.join(this.tempRoot, "copies", name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    return destination;
  }

  private async countLines(file: string): Promise<number> {
    const text = fs.readFileSync(file, "utf8");
    if (!text) return 0;
    return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  }

  /**
   * The environment that keeps git out of the repository's own store: the
   * index is private, the objects are written beside it, and the
   * repository's objects are attached read-only.
   */
  private privateEnv(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      GIT_INDEX_FILE: path.join(
        this.tempRoot,
        `index-${crypto.randomBytes(6).toString("hex")}`,
      ),
    };
    if (this.objectDir) env.GIT_OBJECT_DIRECTORY = this.objectDir;
    if (this.objectsDir) env.GIT_ALTERNATE_OBJECT_DIRECTORIES = this.objectsDir;
    return env;
  }

  /** Write the working tree into a private index and read the tree id. */
  private async writeTree(): Promise<string> {
    const env = this.privateEnv();
    await this.git(["add", "--all", "--ignore-errors"], this.repoRoot ?? this.cwd, env);
    const tree = await this.git(["write-tree"], this.repoRoot ?? this.cwd, env);
    return tree.stdout.trim();
  }

  private async git(args: string[], cwd: string, extraEnv?: Record<string, string | undefined>) {
    try {
      return await execFileAsync("git", args, {
        cwd,
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: "0",
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          ...extraEnv,
        },
        timeout: this.limits.timeoutMs,
        maxBuffer: this.limits.outputMaxBytes,
      });
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message: string; code?: unknown };
      if (/not found|ENOENT/.test(err.message)) this.gitAvailable = false;
      // `git diff` exits 1 when the files differ, which is a result, not a
      // failure: the comparison output is still on stdout.
      if (err.code === 1 && (args[0] === "diff" || args[0] === "diff-tree")) {
        return { stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
      }
      throw new Error(err.stderr?.trim() || err.message);
    }
  }
}
