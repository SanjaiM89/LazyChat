/**
 * The read-before-write observation policy.
 *
 * A file may only be overwritten or edited after the session read it. Reading
 * a missing path confirms its absence, so it may be recreated; a file that
 * changed since the read is refused. The observations are per session and are
 * never persisted.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearObservations,
  guardEdit,
  guardWrite,
  observationOf,
  recordObservation,
  versionOf,
} from "@/lib/agent/observation-policy";

let dir = "";
let file = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-obs-"));
  file = path.join(dir, "a.txt");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("observing", () => {
  it("records what a read saw", () => {
    fs.writeFileSync(file, "one");
    const seen = recordObservation("s1", file);
    assert.equal(seen.kind, "present");
    assert.equal(observationOf("s1", file)?.kind, "present");
  });

  it("records a missing file as absent", () => {
    const seen = recordObservation("s1", file);
    assert.equal(seen.kind, "absent");
  });

  it("keeps the observations of one session apart from another's", () => {
    fs.writeFileSync(file, "one");
    recordObservation("s1", file);
    assert.equal(observationOf("s2", file), undefined);
  });

  it("forgets everything when the session is cleared", () => {
    fs.writeFileSync(file, "one");
    recordObservation("s1", file);
    clearObservations("s1");
    assert.equal(observationOf("s1", file), undefined);
  });

  it("has no version for a missing file", () => {
    assert.equal(versionOf(file), null);
    fs.writeFileSync(file, "one");
    assert.ok(versionOf(file));
  });
});

describe("guarding a write", () => {
  it("allows creating a new file", () => {
    assert.equal(guardWrite("s1", file).ok, true);
  });

  it("refuses to overwrite a file that was never read", () => {
    fs.writeFileSync(file, "one");
    const result = guardWrite("s1", file);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "FS_NOT_OBSERVED");
    assert.match(result.ok === false ? result.reason : "", /has not been read/);
  });

  it("allows overwriting a file that was read", () => {
    fs.writeFileSync(file, "one");
    recordObservation("s1", file);
    assert.equal(guardWrite("s1", file).ok, true);
  });

  it("refuses a file that changed since it was read", () => {
    fs.writeFileSync(file, "one");
    recordObservation("s1", file);
    // Someone else writes the file.
    fs.writeFileSync(file, "one plus more");
    const result = guardWrite("s1", file);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "FS_STALE_VERSION");
  });

  it("refuses to clobber a file that appeared after it was read missing", () => {
    recordObservation("s1", file);
    fs.writeFileSync(file, "created by someone else");
    const result = guardWrite("s1", file);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "FS_STALE_VERSION");
  });

  it("allows recreating a file that was read as missing and stayed missing", () => {
    recordObservation("s1", file);
    assert.equal(guardWrite("s1", file).ok, true);
  });
});

describe("guarding an edit", () => {
  it("refuses an edit of a file that was never read", () => {
    fs.writeFileSync(file, "one");
    const result = guardEdit("s1", file);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "FS_NOT_OBSERVED");
  });

  it("refuses an edit of a file that was read as missing", () => {
    recordObservation("s1", file);
    const result = guardEdit("s1", file);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "FS_NOT_FOUND");
  });

  it("allows an edit of a file that was read", () => {
    fs.writeFileSync(file, "one");
    recordObservation("s1", file);
    assert.equal(guardEdit("s1", file).ok, true);
  });

  it("refuses an edit of a file that changed since it was read", () => {
    fs.writeFileSync(file, "one");
    recordObservation("s1", file);
    fs.writeFileSync(file, "one changed");
    const result = guardEdit("s1", file);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "FS_STALE_VERSION");
  });
});
