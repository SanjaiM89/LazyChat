/**
 * The per-turn change recorder.
 *
 * Every case runs in a throwaway repository under the temporary directory:
 * nothing outside it is created, changed, or removed.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { WorkspaceChangeRecorder } from "@/lib/agent/workspace-changes";

let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  });
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-changes-repo-"));
  git(["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "readme.md"), "one\ntwo\nthree\n");
  git(["add", "readme.md"]);
  git(["commit", "-qm", "initial"]);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("the turn change recorder", () => {
  it("lists the files the turn changed", async () => {
    const recorder = new WorkspaceChangeRecorder(repo);
    await recorder.begin(1);
    fs.writeFileSync(path.join(repo, "readme.md"), "one\ntwo\nthree\nfour\n");
    fs.writeFileSync(path.join(repo, "new.md"), "fresh\n");
    const summary = await recorder.end(1);
    recorder.dispose();

    assert.ok(summary);
    const names = summary.files.map((f) => f.path);
    assert.ok(names.includes("readme.md"), `expected readme.md in ${names.join(", ")}`);
    assert.ok(names.includes("new.md"), `expected new.md in ${names.join(", ")}`);
    const readme = summary.files.find((f) => f.path === "readme.md");
    assert.equal(readme?.added, 1);
    assert.equal(readme?.removed, 0);
  });

  it("does not count the changes the user had already made", async () => {
    // A change that exists before the turn starts.
    fs.writeFileSync(path.join(repo, "readme.md"), "one\ntwo\nthree\npre-existing\n");
    const recorder = new WorkspaceChangeRecorder(repo);
    await recorder.begin(1);
    fs.writeFileSync(path.join(repo, "later.md"), "added during the turn\n");
    const summary = await recorder.end(1);
    recorder.dispose();

    assert.ok(summary);
    const names = summary.files.map((f) => f.path);
    assert.ok(!names.includes("readme.md"), `readme.md should not be listed: ${names.join(", ")}`);
    assert.ok(names.includes("later.md"));
  });

  it("covers files git does not track through the captures", async () => {
    fs.writeFileSync(path.join(repo, ".gitignore"), "ignored.txt\n");
    git(["add", ".gitignore"]);
    git(["commit", "-qm", "ignore"]);
    fs.writeFileSync(path.join(repo, "ignored.txt"), "before\n");

    const recorder = new WorkspaceChangeRecorder(repo);
    await recorder.begin(1);
    // A file tool edits the ignored file: git will not report it.
    recorder.captureBefore(path.join(repo, "ignored.txt"));
    fs.writeFileSync(path.join(repo, "ignored.txt"), "before\nafter\n");
    const summary = await recorder.end(1);
    recorder.dispose();

    assert.ok(summary);
    const ignored = summary.files.find((f) => f.path === "ignored.txt");
    assert.ok(ignored, `expected ignored.txt in ${summary.files.map((f) => f.path).join(", ")}`);
    assert.equal(ignored.source, "capture");
    assert.equal(ignored.added, 1);
  });

  it("leaves the repository's own index and work tree alone", async () => {
    const before = git(["status", "--porcelain"]);
    const recorder = new WorkspaceChangeRecorder(repo);
    await recorder.begin(1);
    fs.writeFileSync(path.join(repo, "readme.md"), "changed\n");
    await recorder.end(1);
    recorder.dispose();

    const after = git(["status", "--porcelain"]);
    // The change is in the work tree, but the index was never written.
    assert.equal(after.includes("M  readme.md"), false, `the index was written: ${after}`);
    assert.equal(before, "");
  });
});
