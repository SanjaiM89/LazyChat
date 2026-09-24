import "server-only";

/* ------------------------------------------------------------------ */
/*  HTTP client for the Docker sandbox service                         */
/*  (sandbox/server.mjs — runs containers, browsers, agent runners)    */
/* ------------------------------------------------------------------ */

const SANDBOX_URL = process.env.SANDBOX_URL || "http://127.0.0.1:8787";
export const SANDBOX_BROWSER_WS = `${SANDBOX_URL.replace(/^http/, "ws")}/browser`;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${SANDBOX_URL}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
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
  /** workdir mounted/created inside the container */
  workspace?: string;
  /** agent runner to launch on start */
  runner?: { task: string; provider: string; model: string; engine: string; config?: any };
}

export async function createSandbox(opts: CreateSandboxOptions = {}) {
  return request<any>("POST", "/containers", {
    image: opts.image || "omnia-sandbox:latest",
    label: opts.label || "sandbox",
    env: opts.env || {},
    workspace: opts.workspace || "/workspace",
    runner: opts.runner,
  });
}

export async function startSandbox(id: string) {
  return request<any>("POST", `/containers/${id}/start`);
}

export async function killSandbox(id: string) {
  return request<any>("POST", `/containers/${id}/kill`);
}

/** Kill the container and drop the sandbox record entirely. */
export async function deleteSandbox(id: string) {
  return request<any>("DELETE", `/containers/${id}`);
}

export async function listSandboxes() {
  return request<any[]>("GET", "/containers");
}

export async function sandboxExec(id: string, command: string, opts?: { stream?: boolean; timeout?: number }) {
  return request<any>("POST", `/containers/${id}/exec`, {
    command,
    stream: opts?.stream ?? false,
    timeout: opts?.timeout ?? 120_000,
  });
}

export async function sandboxWriteFile(id: string, path: string, content: string) {
  return request<any>("POST", `/containers/${id}/write`, { path, content });
}

export async function sandboxReadFile(id: string, path: string): Promise<string> {
  const res = await request<any>("GET", `/containers/${id}/read?path=${encodeURIComponent(path)}`);
  return res.content ?? "";
}

export async function sandboxListFiles(id: string, path = "/workspace") {
  const res = await request<any>("GET", `/containers/${id}/list?path=${encodeURIComponent(path)}`);
  return res.files ?? [];
}

/** Download a binary file out of the container. */
export async function sandboxDownload(id: string, path: string): Promise<Buffer> {
  const res = await fetch(
    `${SANDBOX_URL}/containers/${id}/download?path=${encodeURIComponent(path)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`sandbox download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

/** Latest browser screenshot (jpeg data-url) from the container's Chromium. */
export async function sandboxScreenshot(id: string): Promise<string | null> {
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

/** Build the list of files produced by an agent run (in /workspace/out). */
export async function sandboxResultFiles(id: string, outDir = "/workspace/out") {
  const files = await sandboxListFiles(id, outDir).catch(() => []);
  return files.filter((f: any) => f.type === "file");
}
