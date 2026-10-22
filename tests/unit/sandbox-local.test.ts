import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PORT = 18_790 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;

function hasBwrap(): boolean {
  if (process.platform !== "linux") return false;
  const r = spawnSync("bwrap", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function waitFor(url: string, deadlineMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + deadlineMs;
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve(res);
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${url}`));
      setTimeout(tick, 100);
    };
    void tick();
  });
}

test("local sandbox service confines writes to the workspace", { skip: !hasBwrap() }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-sandbox-test-"));
  const child: ChildProcess = spawn(process.execPath, [path.join(ROOT, "sandbox", "server.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      SANDBOX_PORT: String(PORT),
      DATA_DIR: dataDir,
      SANDBOX_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill("SIGTERM");
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const health = await (await waitFor(`${BASE}/health`, 10_000)).json();
  assert.equal(health.ok, true);
  assert.equal(health.docker, false);
  assert.equal(health.backend, "bubblewrap");

  const created = await (
    await fetch(`${BASE}/containers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "test" }),
    })
  ).json();
  assert.equal(created.state, "ready");
  const id = created.id;

  const exec = await (
    await fetch(`${BASE}/containers/${id}/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "pwd; touch out/ok.txt; echo hi > /tmp/inside; touch /etc/denied 2>&1 || echo denied",
      }),
    })
  ).json();
  assert.equal(exec.exitCode, 0);
  assert.match(exec.output, /workspace/);
  assert.match(exec.output, /denied/);
  assert.match(exec.output, /Read-only file system/);

  const write = await fetch(`${BASE}/containers/${id}/write`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "/workspace/out/note.txt", content: "hello" }),
  });
  assert.equal(write.status, 200);

  const list = await (await fetch(`${BASE}/containers/${id}/list?path=/workspace/out`)).json();
  const names = (list.files || []).map((f: any) => f.name).sort();
  assert.deepEqual(names, ["note.txt", "ok.txt"]);

  const download = await (await fetch(`${BASE}/containers/${id}/download?path=/workspace/out/note.txt`)).text();
  assert.equal(download, "hello");

  const deleted = await fetch(`${BASE}/containers/${id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal(fs.existsSync(path.join(dataDir, "sandboxes", id)), false);
});
