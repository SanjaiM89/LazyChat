import "server-only";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { currentUser } from "@/lib/auth/context";

/**
 * Sandbox client for the local process-sandbox service.
 *
 * The service (`sandbox/server.mjs`) uses bubblewrap to apply DeepSeek
 * Harness's `workspace-write` file-effect policy — no Docker daemon, no
 * container image, no remote VM. This module keeps the same public surface
 * the rest of the app already uses.
 */

const SANDBOX_URL = process.env.SANDBOX_URL || "http://127.0.0.1:8787";
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const OWNERS_FILE = path.join(DATA_DIR, "sandbox-owners.json");
const SECRET = process.env.SANDBOX_SECRET || "";

// Ownership: sandbox id -> uid of the user who created it.
function readOwners(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(OWNERS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function recordOwner(id: string, uid: string) {
  const owners = readOwners();
  owners[id] = uid;
  fs.mkdirSync(path.dirname(OWNERS_FILE), { recursive: true });
  fs.writeFileSync(OWNERS_FILE, JSON.stringify(owners));
}

export function assertSandboxOwner(id: string): void {
  const u = currentUser();
  if (!u) return;
  if (readOwners()[id] !== u.uid) throw new Error("Sandbox not found");
}

export function sandboxHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...(SECRET ? { "x-sandbox-secret": SECRET } : {}),
    ...(extra ?? {}),
  };
}

// The desktop build and `next start` do not run `npm run dev`, so start the
// service lazily on first use. In dev, scripts/sandbox-up.mjs has usually
// already started it; a failed ping is the only condition that spawns.
let serverStart: Promise<void> | null = null;

async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${SANDBOX_URL}/health`, {
      headers: sandboxHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureSandboxServer(): Promise<void> {
  if (await ping()) return;
  if (process.env.OMNIA_SANDBOX_AUTOSTART === "0") {
    throw new Error("Sandbox service is not running. Start it with `npm run sandbox`.");
  }
  if (!serverStart) {
    serverStart = (async () => {
      const script = path.join(process.cwd(), "sandbox", "server.mjs");
      if (!fs.existsSync(script)) {
        throw new Error(`Sandbox service script not found at ${script}`);
      }
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const logPath = path.join(DATA_DIR, "sandbox.log");
      const log = fs.openSync(logPath, "a");
      const child = spawn(process.execPath, [script], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", log, log],
        detached: true,
      });
      child.on("error", () => {});
      child.unref();
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        if (await ping()) return;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`Sandbox service failed to start (see ${logPath})`);
    })().finally(() => {
      serverStart = null;
    });
  }
  await serverStart;
}

async function request(pathname: string, init: RequestInit = {}): Promise<Response> {
  await ensureSandboxServer();
  const res = await fetch(`${SANDBOX_URL}${pathname}`, {
    ...init,
    headers: sandboxHeaders(init.headers as Record<string, string>),
    cache: "no-store",
  });
  if (!res.ok) {
    let message = `sandbox ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore non-JSON errors
    }
    throw new Error(message);
  }
  return res;
}

export async function sandboxHealth() {
  try {
    await ensureSandboxServer();
    const res = await fetch(`${SANDBOX_URL}/health`, {
      headers: sandboxHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    const data = await res.json();
    return { ...data, docker: false };
  } catch (e: any) {
    return { ok: false, docker: false, backend: "local", error: e?.message || String(e) };
  }
}

export interface CreateSandboxOptions {
  image?: string;
  label?: string;
  env?: Record<string, string>;
  workspace?: string;
  runner?: { task: string; provider: string; model: string; engine: string; config?: any };
}

export async function createSandbox(opts: CreateSandboxOptions = {}) {
  const res = await request("/containers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  const meta = await res.json();
  const u = currentUser();
  if (u) recordOwner(meta.id, u.uid);
  return meta;
}

export async function startSandbox(id: string) {
  assertSandboxOwner(id);
  await request(`/containers/${id}/start`, { method: "POST" });
  return { ok: true };
}

export async function killSandbox(id: string) {
  assertSandboxOwner(id);
  try {
    await request(`/containers/${id}/kill`, { method: "POST" });
  } catch {
    /* already gone */
  }
}

export async function deleteSandbox(id: string) {
  assertSandboxOwner(id);
  try {
    await request(`/containers/${id}`, { method: "DELETE" });
  } catch {
    /* already gone */
  }
}

export async function listSandboxes() {
  let all: any[] = [];
  try {
    const res = await request("/containers");
    all = await res.json();
  } catch {
    return [];
  }
  const owners = readOwners();
  const u = currentUser();
  const mapped = (Array.isArray(all) ? all : []).map((s: any) => ({
    id: s.id,
    containerId: s.containerId,
    image: s.image || "local",
    state: s.state,
    label: s.label || "sandbox",
    createdAt: s.createdAt || Date.now(),
    error: s.error,
    hasBrowser: !!s.hasBrowser,
  }));
  if (!u) return mapped;
  return mapped.filter((c: any) => owners[c.id] === u.uid);
}

export async function sandboxExec(id: string, command: string, opts?: { stream?: boolean; timeout?: number }) {
  assertSandboxOwner(id);
  try {
    const res = await request(`/containers/${id}/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, timeout: opts?.timeout }),
    });
    const data = await res.json();
    return {
      output: data.output ?? "",
      stdout: data.output ?? "",
      stderr: data.stderr ?? "",
      exitCode: data.exitCode ?? 0,
    };
  } catch (e: any) {
    return { output: e?.message || String(e), stdout: "", stderr: e?.message || String(e), exitCode: 1 };
  }
}

export async function sandboxWriteFile(id: string, filePath: string, content: string) {
  assertSandboxOwner(id);
  await request(`/containers/${id}/write`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: filePath, content }),
  });
}

export async function sandboxReadFile(id: string, filePath: string): Promise<string> {
  assertSandboxOwner(id);
  const res = await request(`/containers/${id}/read?path=${encodeURIComponent(filePath)}`);
  const data = await res.json();
  return data.content ?? "";
}

export async function sandboxListFiles(id: string, dirPath = "/workspace") {
  assertSandboxOwner(id);
  try {
    const res = await request(`/containers/${id}/list?path=${encodeURIComponent(dirPath)}`);
    const data = await res.json();
    return (Array.isArray(data.files) ? data.files : []).map((f: any) => ({
      name: String(f.name || "").replace(/\/$/, ""),
      type: f.type === "dir" ? "dir" : "file",
      path: f.path,
      size: f.size,
    }));
  } catch {
    return [];
  }
}

export async function sandboxDownload(id: string, filePath: string): Promise<Buffer> {
  assertSandboxOwner(id);
  const res = await request(`/containers/${id}/download?path=${encodeURIComponent(filePath)}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function sandboxScreenshot(id: string): Promise<string | null> {
  assertSandboxOwner(id);
  try {
    const res = await request(`/containers/${id}/screenshot`);
    const data = await res.json();
    return typeof data.image === "string" ? data.image : null;
  } catch {
    return null;
  }
}

export function sandboxBrowserWsUrl(id: string): string {
  return "";
}

export async function sandboxStartBrowser(id: string) {
  assertSandboxOwner(id);
  const res = await request(`/containers/${id}/browser-daemon`, { method: "POST" });
  return res.json();
}

export async function sandboxResultFiles(id: string, outDir = "/workspace/out") {
  assertSandboxOwner(id);
  const files = await sandboxListFiles(id, outDir).catch(() => []);
  return files.filter((f: any) => f.type === "file");
}
