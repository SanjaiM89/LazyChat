/**
 * The session's working directory.
 *
 * The harness treats the cwd as a property of the session: it starts in the
 * workspace, a relative change resolves against the current directory, and the
 * directory is canonical so a symlink and its target are one place.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSessionDirectory, usableDirectory } from "@/lib/agent/session-dir";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omnia-cwd-"));
}

describe("the session directory", () => {
  it("starts canonical, so a symlink and its target are one place", () => {
    const dir = tmpDir();
    const link = path.join(tmpDir(), "link");
    fs.symlinkSync(dir, link);
    assert.equal(createSessionDirectory(link).cwd, fs.realpathSync(dir));
  });

  it("falls back to the process cwd when the start directory is gone", () => {
    const missing = path.join(tmpDir(), "gone");
    assert.equal(createSessionDirectory(missing).cwd, process.cwd());
  });

  it("reads the current directory", () => {
    const dir = tmpDir();
    assert.deepEqual(createSessionDirectory(dir).read(), { cwd: fs.realpathSync(dir) });
  });

  it("resolves a relative change against the current directory", () => {
    const dir = tmpDir();
    const sub = path.join(dir, "sub");
    fs.mkdirSync(sub);
    const session = createSessionDirectory(dir);
    const result = session.set("sub");
    assert.ok("cwd" in result);
    assert.equal(result.cwd, fs.realpathSync(sub));
    assert.equal(session.cwd, fs.realpathSync(sub));
  });

  it("takes an absolute change as given", () => {
    const here = tmpDir();
    const there = tmpDir();
    const session = createSessionDirectory(here);
    const result = session.set(there);
    assert.ok("cwd" in result);
    assert.equal(result.cwd, fs.realpathSync(there));
  });

  it("refuses a directory that does not exist, and stays put", () => {
    const dir = tmpDir();
    const session = createSessionDirectory(dir);
    const result = session.set("nope");
    assert.ok("error" in result);
    assert.match(result.error, /does not exist/);
    assert.equal(session.cwd, fs.realpathSync(dir));
  });

  it("refuses a file", () => {
    const dir = tmpDir();
    const file = path.join(dir, "a-file");
    fs.writeFileSync(file, "x");
    const session = createSessionDirectory(dir);
    const result = session.set("a-file");
    assert.ok("error" in result);
    assert.match(result.error, /not a directory/);
  });

  it("keeps a usable directory", () => {
    const dir = tmpDir();
    assert.equal(usableDirectory(dir), fs.realpathSync(dir));
    assert.equal(usableDirectory(path.join(dir, "gone")), process.cwd());
  });
});
