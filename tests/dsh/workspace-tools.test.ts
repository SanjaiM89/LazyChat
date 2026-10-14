/**
 * Native workspace tool tests: confinement first, then function.
 *
 * The chat agent gets shell + filesystem power only inside the attached
 * folder — traversal, absolute escapes and symlink-out must all fail.
 *
 * Run: `npm run test:brain` (sequential files; live graph required)
 */
import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FalkorClient } from "../../lib/brain/graph";
import { createWorkspace } from "../../lib/dsh/workspaces";
import { buildWorkspaceTools, resolveIn } from "../../lib/dsh/workspace-tools";

const WS_IDS: string[] = [];
let ROOT = "";

function tmpRoot(): string {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-wstools-"));
  fs.mkdirSync(path.join(ROOT, "sub"));
  fs.writeFileSync(path.join(ROOT, "sub", "secret.txt"), "shh");
  fs.writeFileSync(path.join(ROOT, "readme.md"), "# demo");
  return ROOT;
}

afterEach(async () => {
  const client = await FalkorClient.get();
  while (WS_IDS.length > 0) {
    const id = WS_IDS.pop() as string;
    await client.write(
      "MATCH (w:Workspace {id: $id}) OPTIONAL MATCH (w)-[]-(x) DETACH DELETE w, x",
      { id },
    );
    await client.write("MATCH (n) WHERE n.workspace_id = $id DETACH DELETE n", { id });
  }
});

after(async () => {
  try {
    if (ROOT) fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    // best effort
  }
  await (await FalkorClient.get()).close();
});

describe("resolveIn confinement", () => {
  it("allows normal relative paths", () => {
    const root = tmpRoot();
    assert.equal(resolveIn(root, ""), root);
    assert.equal(resolveIn(root, "sub/secret.txt"), path.join(root, "sub", "secret.txt"));
  });

  it("rejects traversal and absolute escapes", () => {
    const root = tmpRoot();
    assert.throws(() => resolveIn(root, ".."), /escapes/);
    assert.throws(() => resolveIn(root, "sub/../../.."), /escapes/);
    assert.throws(() => resolveIn(root, "/etc/passwd"), /escapes/);
  });

  it("rejects symlinks pointing outside", () => {
    const root = tmpRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-outside-"));
    fs.writeFileSync(path.join(outside, "x.txt"), "x");
    try {
      fs.symlinkSync(outside, path.join(root, "link"));
      assert.throws(() => resolveIn(root, "link/x.txt"), /escapes/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("workspace tools in chat", () => {
  type Exec = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  const call = (t: { execute?: unknown }, args: Record<string, unknown>) =>
    (t.execute as Exec)(args);

  it("lists, reads, writes and shells inside the root", async () => {
    const client = await FalkorClient.get();
    const root = tmpRoot();
    const ws = await createWorkspace(client, { name: "Tools WS", path: root });
    WS_IDS.push(ws.id);
    const tools = buildWorkspaceTools({ workspaceId: ws.id, root });

    const listed = (await call(tools.ws_list, { path: "" })) as unknown as {
      entries: Array<{ name: string; dir: boolean }>;
    };
    assert.ok(listed.entries.some((e) => e.name === "readme.md"));

    const read = (await call(tools.ws_read, { path: "readme.md" })) as unknown as { content: string };
    assert.ok(read.content.includes("# demo"));

    const written = (await call(tools.ws_write, { path: "new/note.txt", content: "hi" })) as unknown as {
      path: string;
    };
    assert.equal(written.path, "new/note.txt");
    assert.equal(fs.readFileSync(path.join(root, "new/note.txt"), "utf8"), "hi");

    const shelled = (await call(tools.ws_shell, { command: "pwd && echo ok", timeout_s: 30 })) as unknown as {
      exit_code: number;
      output: string;
    };
    assert.equal(shelled.exit_code, 0);
    assert.ok(shelled.output.includes(root));
    assert.ok(shelled.output.includes("ok"));
  });

  it("tools refuse to leave the root", async () => {
    const client = await FalkorClient.get();
    const root = tmpRoot();
    const ws = await createWorkspace(client, { name: "Jail WS", path: root });
    WS_IDS.push(ws.id);
    const tools = buildWorkspaceTools({ workspaceId: ws.id, root });
    await assert.rejects(call(tools.ws_read, { path: "../outside.txt" }));
    await assert.rejects(call(tools.ws_write, { path: "../../evil.txt", content: "x" }));
  });
});
