/**
 * The workspace registry, harness-shaped.
 *
 * Covers the path canon (absolute only, realpath, symlink collision), the
 * title rules, the durable order, removal that keeps the directory, the live
 * directory status, and the membership rule: a session belongs to the
 * workspace whose path equals its working directory.
 *
 * Run: `npm run test:brain` (sequential files; live graph required)
 */
import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LLM_FORCE_MOCK = "1";

import { FalkorClient } from "../../lib/brain/graph";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  moveWorkspaceBefore,
  readWorkspaceRegistryState,
  recoverWorkspaceRegistry,
  setWorkspaceTitle,
} from "../../lib/workspace/workspaces";
import { defaultWorkspaceTitle, realpathNormalize } from "../../lib/workspace/paths";
import { membersOf } from "../../lib/workspace/membership";

const WS_IDS: string[] = [];
const TMPDIRS: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-reg-"));
  TMPDIRS.push(dir);
  return dir;
}

afterEach(async () => {
  const client = await FalkorClient.get();
  while (WS_IDS.length > 0) {
    const id = WS_IDS.pop() as string;
    await client.write("MATCH (w:Workspace {id: $id}) DETACH DELETE w", { id });
  }
});

after(async () => {
  for (const dir of TMPDIRS) fs.rmSync(dir, { recursive: true, force: true });
  // The graph connection keeps the process alive otherwise.
  await (await FalkorClient.get()).close();
});

describe("the path canon", () => {
  it("rejects a relative path", () => {
    assert.throws(() => realpathNormalize("relative/path"), /not fully qualified/);
  });

  it("rejects a path that does not exist", () => {
    assert.throws(() => realpathNormalize("/definitely/not/here"), /ENOENT|no such file/);
  });

  it("resolves trailing slashes, .. and symlinks to one place", () => {
    const dir = tmpDir();
    const link = path.join(tmpDir(), "link");
    fs.symlinkSync(dir, link);
    const canonical = realpathNormalize(dir);
    assert.equal(realpathNormalize(dir + "/"), canonical);
    assert.equal(realpathNormalize(path.join(dir, "..", path.basename(dir))), canonical);
    assert.equal(realpathNormalize(link), canonical);
  });

  it("names the workspace after the folder", () => {
    assert.equal(defaultWorkspaceTitle("/home/sanjai/projects/games/chess"), "chess");
    assert.equal(defaultWorkspaceTitle("/"), "/");
  });
});

describe("creating a workspace", () => {
  it("registers any existing directory on the machine", async () => {
    const client = await FalkorClient.get();
    const dir = tmpDir();
    const ws = await createWorkspace(client, { path: dir, owner: "local" });
    WS_IDS.push(ws.id);
    assert.equal(ws.path, fs.realpathSync(dir));
    assert.equal(ws.title, path.basename(fs.realpathSync(dir)));
    assert.equal(ws.dir_status, "ok");
  });

  it("rejects a relative path", async () => {
    const client = await FalkorClient.get();
    await assert.rejects(() => createWorkspace(client, { path: "relative", owner: "local" }), /not fully qualified/);
  });

  it("rejects a path that is not a directory", async () => {
    const client = await FalkorClient.get();
    const file = path.join(tmpDir(), "a-file");
    fs.writeFileSync(file, "x");
    await assert.rejects(() => createWorkspace(client, { path: file, owner: "local" }), /not a directory/);
  });

  it("returns the same record for the same folder, title untouched", async () => {
    const client = await FalkorClient.get();
    const dir = tmpDir();
    const first = await createWorkspace(client, { path: dir, title: "First", owner: "local" });
    WS_IDS.push(first.id);
    const again = await createWorkspace(client, { path: dir, title: "Second", owner: "local" });
    assert.equal(again.id, first.id);
    assert.equal(again.title, "First");
  });

  it("treats a symlink to the same folder as the same workspace", async () => {
    const client = await FalkorClient.get();
    const dir = tmpDir();
    const link = path.join(tmpDir(), "link");
    fs.symlinkSync(dir, link);
    const first = await createWorkspace(client, { path: dir, owner: "local" });
    WS_IDS.push(first.id);
    const viaLink = await createWorkspace(client, { path: link, owner: "local" });
    assert.equal(viaLink.id, first.id);
  });

  it("puts the newest workspace at the head of the order", async () => {
    const client = await FalkorClient.get();
    const a = await createWorkspace(client, { path: tmpDir(), owner: "local" });
    const b = await createWorkspace(client, { path: tmpDir(), owner: "local" });
    WS_IDS.push(a.id, b.id);
    const all = await listWorkspaces(client, true);
    const order = all.filter((w) => w.id === a.id || w.id === b.id).map((w) => w.id);
    assert.deepEqual(order, [b.id, a.id]);
  });
});

describe("renaming and reordering", () => {
  it("replaces the title and leaves the path alone", async () => {
    const client = await FalkorClient.get();
    const dir = tmpDir();
    const ws = await createWorkspace(client, { path: dir, owner: "local" });
    WS_IDS.push(ws.id);
    const renamed = await setWorkspaceTitle(client, ws.id, "Chess Backend");
    assert.equal(renamed.title, "Chess Backend");
    assert.equal(renamed.path, ws.path);
  });

  it("moves a workspace before an anchor", async () => {
    const client = await FalkorClient.get();
    const a = await createWorkspace(client, { path: tmpDir(), owner: "local" });
    const b = await createWorkspace(client, { path: tmpDir(), owner: "local" });
    WS_IDS.push(a.id, b.id);
    await moveWorkspaceBefore(client, a.id, b.id);
    const all = await listWorkspaces(client, true);
    const order = all.filter((w) => w.id === a.id || w.id === b.id).map((w) => w.id);
    assert.deepEqual(order, [a.id, b.id]);
  });

  it("refuses to reorder an unknown workspace", async () => {
    const client = await FalkorClient.get();
    await assert.rejects(() => moveWorkspaceBefore(client, "nope", "also-nope"), /unknown workspace/);
  });
});

describe("removing a workspace", () => {
  it("keeps the directory and the record's history", async () => {
    const client = await FalkorClient.get();
    const dir = tmpDir();
    const ws = await createWorkspace(client, { path: dir, owner: "local" });
    assert.equal(await deleteWorkspace(client, ws.id), true);
    assert.equal(fs.existsSync(dir), true);
    assert.equal(await getWorkspace(client, ws.id), null);
  });

  it("is a no-op for an unknown id", async () => {
    const client = await FalkorClient.get();
    assert.equal(await deleteWorkspace(client, "nope"), false);
  });
});

describe("the live directory status", () => {
  it("reports a missing folder without touching the record", async () => {
    const client = await FalkorClient.get();
    const dir = tmpDir();
    const ws = await createWorkspace(client, { path: dir, owner: "local" });
    WS_IDS.push(ws.id);
    assert.equal(ws.dir_status, "ok");
    fs.rmSync(dir, { recursive: true, force: true });
    const after = await getWorkspace(client, ws.id);
    assert.ok(after);
    assert.equal(after.dir_status, "missing-dir");
    // The record itself is intact: the folder may only have been moved.
    assert.equal(after.path, ws.path);
  });
});

describe("membership is by working directory", () => {
  const session = (id: string, cwd: string) => ({ id, title: id, cwd, updatedAt: 0 });

  it("counts the sessions that run in the folder", () => {
    const dir = tmpDir();
    const members = membersOf([session("a", dir), session("b", dir + "/sub")], dir);
    assert.deepEqual(members.map((m) => m.id), ["a"]);
  });

  it("drops a session that moved elsewhere", () => {
    const dir = tmpDir();
    const other = tmpDir();
    const members = membersOf([session("a", other)], dir);
    assert.equal(members.length, 0);
  });

  it("ignores a session with no directory", () => {
    const dir = tmpDir();
    assert.equal(membersOf([session("a", "")], dir).length, 0);
  });

  it("matches through a symlink, because the comparison is canonical", () => {
    const dir = tmpDir();
    const link = path.join(tmpDir(), "link");
    fs.symlinkSync(dir, link);
    assert.equal(membersOf([session("a", link)], dir).length, 1);
  });
});

describe("the registry state", () => {
  it("keeps the first-use identity even after that workspace is deleted", async () => {
    const client = await FalkorClient.get();
    const first = await createWorkspace(client, { path: tmpDir(), owner: "local" });
    WS_IDS.push(first.id);
    const state = await readWorkspaceRegistryState(client);
    // The first workspace to exist owns the first-use identity.
    assert.ok(state.defaultWorkspaceId);

    await deleteWorkspace(client, first.id);
    const after = await readWorkspaceRegistryState(client);
    assert.equal(after.defaultWorkspaceId, state.defaultWorkspaceId);
  });

  it("clears the pending marker once a registration completes", async () => {
    const client = await FalkorClient.get();
    const ws = await createWorkspace(client, { path: tmpDir(), owner: "local" });
    WS_IDS.push(ws.id);
    const state = await readWorkspaceRegistryState(client);
    assert.equal(state.pending, null);
  });

  it("recovers an interrupted registration", async () => {
    const client = await FalkorClient.get();
    const dir = tmpDir();
    const ws = await createWorkspace(client, { path: dir, owner: "local" });
    WS_IDS.push(ws.id);

    // Simulate a crash between the marker and the record: the marker is left
    // behind for a workspace that never landed.
    await client.write(
      "MERGE (s:WorkspaceState {id: 'registry'}) SET s.pending_operation = 'create', " +
        "s.pending_workspace_id = 'ws-interrupted'",
    );
    const recovered = await recoverWorkspaceRegistry(client);
    assert.equal(recovered.pending, null);
    // The half-made registration left nothing behind.
    assert.equal(await getWorkspace(client, "ws-interrupted"), null);
  });
});
