import "server-only";
import fs from "node:fs";
import path from "node:path";
import { currentUser } from "@/lib/auth/context";


const SANDBOX_URL = process.env.SANDBOX_URL || "http://127.0.0.1:8787";
export const SANDBOX_BROWSER_WS = `${SANDBOX_URL.replace(/^http/, "ws")}/browser`;

/** Shared secret so only this app can drive the sandbox service. */
export function sandboxHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...(extra ?? {}), ...(process.env.SANDBOX_SECRET ? { "x-sandbox-secret": process.env.SANDBOX_SECRET } : {}) };
}

// Ownership: sandbox id -> uid of the user who created it.
const OWNERS_FILE = path.join(process.cwd(), "data", "sandbox-owners.json");

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

/** Throws unless the signed-in user owns this sandbox. Outside a request (no user) it is a no-op. */
export function assertSandboxOwner(id: string): void {
  const u = currentUser();
  if (!u) return;
  if (readOwners()[id] !== u.uid) throw new Error("Sandbox not found");
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${SANDBOX_URL}${path}`, {
    method,
    headers: sandboxHeaders(body ? { "content-type": "application/json" } : undefined),
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = typeof data === "string" ? data : data?.error || res.statusText;
    throw new Error(`sandbox ${method} ${path}: ${msg}`);
  }
  return data as T;
}

export interface SandboxHealth {
  ok: boolean;
  docker: boolean;
  version?: string;
  images?: string[];
  activeContainers?: number;
}

export async function sandboxHealth(): Promise<SandboxHealth> {
  try {
    return await request<SandboxHealth>("GET", "/health");
  } catch {
    return { ok: false, docker: false };
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
  const created = await request<any>("POST", "/containers", {
    image: opts.image || "omnia-sandbox:latest",
    label: opts.label || "sandbox",
    env: opts.env || {},
    workspace: opts.workspace || "/workspace",
    runner: opts.runner,
  });
  const u = currentUser();
  if (u && created?.id) recordOwner(created.id, u.uid);
  return created;
}

export async function startSandbox(id: string) {
  assertSandboxOwner(id);
  return request<any>("POST", `/containers/${id}/start`);
}

export async function killSandbox(id: string) {
  assertSandboxOwner(id);
  return request<any>("POST", `/containers/${id}/kill`);
}

export async function deleteSandbox(id: string) {
  assertSandboxOwner(id);
  return request<any>("DELETE", `/containers/${id}`);
}

export async function listSandboxes() {
  const all = await request<any[]>("GET", "/containers");
  const u = currentUser();
  if (!u) return all;
  const owners = readOwners();
  return all.filter((c) => owners[c.id] === u.uid);
}

export async function sandboxExec(id: string, command: string, opts?: { stream?: boolean; timeout?: number }) {
  assertSandboxOwner(id);
  return request<any>("POST", `/containers/${id}/exec`, {
    command,
    stream: opts?.stream ?? false,
    timeout: opts?.timeout ?? 120_000,
  });
}

export async function sandboxWriteFile(id: string, path: string, content: string) {
  assertSandboxOwner(id);
  return request<any>("POST", `/containers/${id}/write`, { path, content });
}

export async function sandboxReadFile(id: string, path: string): Promise<string> {
  assertSandboxOwner(id);
  const res = await request<any>("GET", `/containers/${id}/read?path=${encodeURIComponent(path)}`);
  return res.content ?? "";
}

export async function sandboxListFiles(id: string, path = "/workspace") {
  assertSandboxOwner(id);
  const res = await request<any>("GET", `/containers/${id}/list?path=${encodeURIComponent(path)}`);
  return res.files ?? [];
}

export async function sandboxDownload(id: string, path: string): Promise<Buffer> {
  assertSandboxOwner(id);
  const res = await fetch(
    `${SANDBOX_URL}/containers/${id}/download?path=${encodeURIComponent(path)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`sandbox download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

export async function sandboxScreenshot(id: string): Promise<string | null> {
  assertSandboxOwner(id);
  try {
    const res = await request<any>("GET", `/containers/${id}/screenshot`);
    return res.image || null;
  } catch {
    return null;
  }
}

export function sandboxBrowserWsUrl(id: string): string {
  return `${SANDBOX_BROWSER_WS}/${id}`;
}

export async function sandboxResultFiles(id: string, outDir = "/workspace/out") {
  assertSandboxOwner(id);
  const files = await sandboxListFiles(id, outDir).catch(() => []);
  return files.filter((f: any) => f.type === "file");
}
