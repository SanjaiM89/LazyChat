/**
 * Git worktrees.
 *
 * A worktree is another checkout of the same repository: a new branch, its
 * own directory, the same objects. The source checkout keeps its uncommitted
 * files, so an experiment never disturbs the work in progress.
 *
 * The worktree lives under the app's own data directory, not inside the
 * repository, so the repository is never polluted with checkouts.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DATA_DIR } from "@/lib/data-dir";

export interface WorktreeResult {
  /** The directory of the new checkout. */
  path: string;
  /** The branch that was created. */
  branch: string;
  /** The commit it was created from. */
  baseCommit: string;
  /** The repository the worktree belongs to. */
  repositoryRoot: string;
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || err.message || "").trim() || "git failed"));
        return;
      }
      resolve(String(stdout ?? "").trim());
    });
  });
}

/** The directory the worktrees live in. */
export function worktreeRoot(): string {
  const dir = process.env.OMNIA_WORKTREE_DIR || path.join(DATA_DIR, "worktrees");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a worktree.
 *
 * @param opts - The repository to work in, the branch name and the commit to
 *   start from.
 * @returns The new checkout.
 */
export async function createWorktree(opts: {
  /** The directory the session is in. */
  cwd: string;
  /** The branch name; it is also the directory name. One is generated when omitted. */
  name?: string;
  /** A local commit, branch or tag. Defaults to HEAD; nothing is fetched. */
  from?: string;
}): Promise<WorktreeResult> {
  const repositoryRoot = await git(["rev-parse", "--show-toplevel"], opts.cwd);
  const from = (opts.from ?? "HEAD").trim();
  const baseCommit = await git(["rev-parse", from], repositoryRoot);

  const name = (opts.name ?? "").trim() || `worktree-${Date.now().toString(36)}`;
  if (!/^[\w.-]+$/.test(name)) {
    throw new Error(`"${name}" is not a usable branch name.`);
  }
  // An existing name fails: neither the branch nor the directory may be taken.
  const existingBranch = await git(["branch", "--list", name], repositoryRoot);
  if (existingBranch) {
    throw new Error(`A branch called "${name}" already exists.`);
  }
  const target = path.join(worktreeRoot(), name);
  if (fs.existsSync(target)) {
    throw new Error(`A worktree called "${name}" already exists.`);
  }

  // The branch is created from the pinned commit, not from the working tree:
  // the uncommitted files stay where they are.
  await git(["worktree", "add", "-b", name, target, baseCommit], repositoryRoot);

  return {
    path: fs.realpathSync(target),
    branch: name,
    baseCommit,
    repositoryRoot,
  };
}

/** The worktrees of a repository, with the branch and the commit each is on. */
export async function listWorktrees(cwd: string): Promise<
  Array<{ path: string; branch: string; head: string; detached: boolean }>
> {
  const repositoryRoot = await git(["rev-parse", "--show-toplevel"], cwd);
  const raw = await git(["worktree", "list", "--porcelain"], repositoryRoot);
  const out: Array<{ path: string; branch: string; head: string; detached: boolean }> = [];
  let current: { path: string; branch: string; head: string; detached: boolean } | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) out.push(current);
      current = { path: line.slice("worktree ".length), branch: "", head: "", detached: false };
    } else if (line.startsWith("HEAD ") && current) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line.trim() === "detached" && current) {
      current.detached = true;
    }
  }
  if (current) out.push(current);
  return out;
}
