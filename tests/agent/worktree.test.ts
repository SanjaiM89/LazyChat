/**
 * The worktree tools.
 *
 * A worktree is another checkout of the same repository: a new branch, its
 * own directory, the same objects. The source checkout keeps its uncommitted
 * files. The test uses a throwaway repository in a temp directory.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createWorktree, listWorktrees } from "@/lib/agent/worktree";

let dir = "";
let repo = "";
let worktrees = "";

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-wt-"));
  // The worktrees live in their own directory, so the test never touches the
  // app's data.
  worktrees = path.join(dir, "worktrees");
  process.env.OMNIA_WORKTREE_DIR = worktrees;
  repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(repo, "README.md"), "one\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "first"]);
});

afterEach(() => {
  delete process.env.OMNIA_WORKTREE_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("creating a worktree", () => {
  it("makes a new branch and a new checkout", async () => {
    const result = await createWorktree({ cwd: repo, name: "feature" });
    assert.equal(result.branch, "feature");
    assert.equal(result.repositoryRoot, fs.realpathSync(repo));
    assert.ok(result.baseCommit.length >= 7);
    assert.equal(fs.existsSync(path.join(result.path, "README.md")), true);
    // The branch exists in the repository.
    assert.equal(git(["branch", "--list", "feature"]).replace(/^[+* ]+/, ""), "feature");
  });

  it("starts from HEAD by default", async () => {
    const result = await createWorktree({ cwd: repo, name: "from-head" });
    assert.equal(result.baseCommit, git(["rev-parse", "HEAD"]));
  });

  it("starts from a named commit", async () => {
    const first = git(["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(repo, "README.md"), "two\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "second"]);
    const result = await createWorktree({ cwd: repo, name: "from-old", from: first });
    assert.equal(result.baseCommit, first);
    // The worktree has the old content.
    assert.equal(fs.readFileSync(path.join(result.path, "README.md"), "utf8"), "one\n");
  });

  it("refuses a name that is taken", async () => {
    await createWorktree({ cwd: repo, name: "taken" });
    await assert.rejects(() => createWorktree({ cwd: repo, name: "taken" }), /already exists/);
  });

  it("refuses a name that is not usable as a branch", async () => {
    await assert.rejects(
      () => createWorktree({ cwd: repo, name: "bad name" }),
      /not a usable branch name/,
    );
  });

  it("leaves the uncommitted files in the source checkout", async () => {
    fs.writeFileSync(path.join(repo, "scratch.txt"), "work in progress");
    const result = await createWorktree({ cwd: repo, name: "clean" });
    assert.equal(fs.existsSync(path.join(repo, "scratch.txt")), true);
    assert.equal(fs.existsSync(path.join(result.path, "scratch.txt")), false);
  });

  it("generates a name when none is given", async () => {
    const result = await createWorktree({ cwd: repo });
    assert.match(result.branch, /^worktree-/);
  });
});

describe("listing worktrees", () => {
  it("lists the checkouts of the repository", async () => {
    await createWorktree({ cwd: repo, name: "listed" });
    const worktrees = await listWorktrees(repo);
    assert.ok(worktrees.length >= 2);
    const listed = worktrees.find((w) => w.branch === "listed");
    assert.ok(listed);
    assert.equal(listed.detached, false);
  });
});
