#!/usr/bin/env node
/**
 * Local sandbox service.
 *
 * DeepSeek Harness does not run agent work in a container. It confines the
 * child process to a file-effect policy with the host kernel: bubblewrap on
 * Linux, Seatbelt on macOS, Landlock where bubblewrap is unavailable. This
 * service applies the same `workspace-write` policy to Omnia agent runs:
 *
 *   - the host filesystem is mounted read-only,
 *   - the sandbox workspace (and a private /tmp) is writable,
 *   - a private PID namespace/procfs is provided,
 *   - no network namespace is created, exactly like dsh's process sandbox.
 *
 * The HTTP API is unchanged so the existing chat UI, agent runner, and
 * Chromium panel keep working without Docker or a remote CodeSandbox.
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SANDBOX_PORT || 8787);
const SECRET = process.env.SANDBOX_SECRET || "";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const SANDBOX_DIR = path.join(DATA_DIR, "sandboxes");
const BWRAP = process.env.BWRAP_BIN || "bwrap";
const PLATFORM = process.platform;
// When the desktop app is packaged, Node and the runner live on an AppImage
// FUSE submount. bubblewrap's `--ro-bind / /` does not recursively include
// FUSE submounts, so the AppImage mount must be bound into the sandbox
// explicitly (after /tmp becomes a tmpfs).
const APPIMAGE_MOUNT = (() => {
  const m = /^(\/tmp\/\.mount_[^/]+)/.exec(process.execPath);
  return m ? m[1] : null;
})();
const RUNNER = path.join(ROOT, "sandbox", "container", "runner.mjs");
const BROWSER_DAEMON = path.join(ROOT, "sandbox", "container", "browser-daemon.mjs");
const DEFAULT_IMAGE = "local";
fs.mkdirSync(SANDBOX_DIR, { recursive: true });

const sandboxes = new Map();

function makeSandbox(id) {
  return {
    id,
    containerId: null,
    image: DEFAULT_IMAGE,
    label: "sandbox",
    state: "starting", // starting | ready | busy | idle | error | stopped
    hasBrowser: true,
    error: null,
    createdAt: Date.now(),
    workspaceDir: path.join(SANDBOX_DIR, id, "workspace"),
    events: new Set(),
    lastScreenshot: null,
    env: {},
    runnerSpec: null,
    child: null,
    browser: null,
  };
}

function get(id) {
  return sandboxes.get(id);
}

function setState(id, state, error) {
  const s = get(id);
  if (!s) return;
  s.state = state;
  if (error !== undefined) s.error = error;
}

function snapshot(s) {
  return {
    id: s.id,
    containerId: s.containerId,
    image: s.image,
    label: s.label,
    state: s.state,
    hasBrowser: s.hasBrowser,
    createdAt: s.createdAt,
    error: s.error,
  };
}

// ---------------------------------------------------------------------------
// Process confinement (same profile as @deepseek-ai/dsh-sandbox-local)
// ---------------------------------------------------------------------------

const BWRAP_ARGS = ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--proc", "/proc", "--die-with-parent"];

function sbplString(p) {
  return JSON.stringify(String(p));
}

/** dsh's Seatbelt `workspace-write` profile (macOS). */
function seatbeltProfile(workspaceDir) {
  const writable = ["/tmp", workspaceDir].map((p) => `(subpath ${sbplString(p)})`).join(" ");
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (literal ${sbplString("/dev/null")}) (literal ${sbplString("/dev/stdout")}) (literal ${sbplString("/dev/stderr")}) ${writable})`,
  ].join(" ");
}

let probeCache = null;

function sandboxSupport() {
  if (probeCache && Date.now() - probeCache.at < 10_000) return probeCache.value;
  let value;
  if (PLATFORM === "linux") {
    const r = spawnSync(BWRAP, ["--version"], { encoding: "utf8", timeout: 5000 });
    const version = r.status === 0 ? (r.stdout || "").trim() : "";
    if (!version) {
      value = {
        ok: false,
        backend: "unavailable",
        error: `bubblewrap (${BWRAP}) is not installed. Install it (e.g. apt install bubblewrap) and retry.`,
      };
    } else {
      const probe = spawnSync(BWRAP, [...BWRAP_ARGS, "--", "true"], { timeout: 5000, stdio: "ignore" });
      value =
        probe.status === 0
          ? { ok: true, backend: "bubblewrap", version }
          : {
              ok: false,
              backend: "unavailable",
              version,
              error:
                "bubblewrap cannot create an unprivileged namespace on this host; check user namespaces / AppArmor.",
            };
    }
  } else if (PLATFORM === "darwin") {
    const probe = spawnSync("sandbox-exec", ["-p", "(version 1)(allow default)", "--", "true"], {
      timeout: 5000,
      stdio: "ignore",
    });
    value =
      probe.status === 0
        ? { ok: true, backend: "seatbelt", version: "sandbox-exec" }
        : {
            ok: false,
            backend: "unavailable",
            error: "sandbox-exec is unavailable; refusing to run commands unconfined.",
          };
  } else {
    value = {
      ok: false,
      backend: "unavailable",
      error: `no sandbox backend for ${PLATFORM}; refusing to run commands unconfined.`,
    };
  }
  probeCache = { at: Date.now(), value };
  return value;
}

/** Wrap argv in dsh's `workspace-write` confinement profile. */
function confine(argv, workspaceDir) {
  if (PLATFORM === "darwin") {
    return ["sandbox-exec", "-p", seatbeltProfile(workspaceDir), "--", ...argv];
  }
  const args = [BWRAP, ...BWRAP_ARGS, "--tmpfs", "/tmp"];
  if (APPIMAGE_MOUNT) {
    args.push("--dir", APPIMAGE_MOUNT, "--ro-bind", APPIMAGE_MOUNT, APPIMAGE_MOUNT);
  }
  args.push("--bind", workspaceDir, workspaceDir, "--", ...argv);
  return args;
}

function killChild(child) {
  if (!child || child.killed) return;
  try {
    // Spawned detached: signal the whole process group so the runner's
    // children (browser, shell commands) do not outlive their sandbox.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ENV_RE =
  /^(AGENT|OMNIA|ANTHROPIC|OPENAI|GOOGLE|GEMINI|OLLAMA|LMSTUDIO|DEEPSEEK|GROQ|XAI|MISTRAL|OPENROUTER|AZURE|GITHUB|FIREWORKS|TOGETHER|NVIDIA|AWS|SANDBOX|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)_|_API_KEY$|_BASE_URL$|_API_KEY_ID$|_SECRET$|_TOKEN$/i;

const NEVER_FORWARD = new Set([
  "SUPER_ADMIN_EMAIL",
  "SUPER_ADMIN_PASSWORD",
  "NEXT_PUBLIC_SUPER_ADMIN_EMAIL",
  "OMNIA_INTERNAL_TOKEN",
  "SANDBOX_SECRET",
  "FALKORDB_PASSWORD",
  "CSB_API_KEY",
  "CODESANDBOX_API_KEY",
  "SARVAM_API_KEY",
]);

function filteredEnv(source = {}) {
  const env = {};
  for (const [k, v] of Object.entries(source)) {
    if (!v || typeof v !== "string") continue;
    if (k.startsWith("NEXT_PUBLIC_")) continue;
    if (NEVER_FORWARD.has(k)) continue;
    if (ENV_RE.test(k)) env[k] = v;
  }
  return env;
}

function sandboxEnv(s, extra = {}) {
  const home = path.join(s.workspaceDir, ".home");
  const env = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    TMPDIR: "/tmp",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "",
    TZ: process.env.TZ || "UTC",
    XDG_CACHE_HOME: path.join(s.workspaceDir, ".cache"),
    XDG_CONFIG_HOME: path.join(s.workspaceDir, ".config"),
    XDG_DATA_HOME: path.join(s.workspaceDir, ".local", "share"),
    PLAYWRIGHT_BROWSERS_PATH:
      process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), ".cache", "ms-playwright"),
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS || "",
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || "",
    SSL_CERT_DIR: process.env.SSL_CERT_DIR || "",
    HTTP_PROXY: process.env.HTTP_PROXY || process.env.http_proxy || "",
    HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy || "",
    NO_PROXY: process.env.NO_PROXY || process.env.no_proxy || "",
    ...filteredEnv(s.rawEnv || {}),
    AGENT_TASK: s.runnerSpec?.task || "",
    AGENT_MODE: s.rawEnv?.AGENT_MODE || "",
    SANDBOX_HOST: `http://127.0.0.1:${PORT}`,
    SANDBOX_SECRET: SECRET,
    SANDBOX_ID: s.id,
    SANDBOX_LABEL: s.label,
    OMNIA_WORKSPACE: s.workspaceDir,
    ...extra,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === "" || v === undefined || v === null) delete env[k];
  }
  return env;
}

function prepareWorkspace(s) {
  s.workspaceDir = path.join(SANDBOX_DIR, s.id, "workspace");
  fs.mkdirSync(path.join(s.workspaceDir, "out"), { recursive: true });
  fs.mkdirSync(path.join(s.workspaceDir, ".home"), { recursive: true });
  fs.mkdirSync(path.join(s.workspaceDir, ".cache"), { recursive: true });
  fs.mkdirSync(path.join(s.workspaceDir, ".config"), { recursive: true });
  fs.mkdirSync(path.join(s.workspaceDir, ".local", "share"), { recursive: true });
}

// ---------------------------------------------------------------------------
// Runner / browser processes
// ---------------------------------------------------------------------------

function startRunner(s) {
  if (!s.runnerSpec) return;
  if (s.child) return;
  const spec = s.runnerSpec;
  const logPath = path.join(SANDBOX_DIR, s.id, "runner.log");
  const log = fs.openSync(logPath, "a");
  const argv = confine(
    [process.execPath, RUNNER, s.id, spec.provider, spec.model, spec.engine || "tool-loop"],
    s.workspaceDir,
  );
  const child = spawn(argv[0], argv.slice(1), {
    cwd: s.workspaceDir,
    env: sandboxEnv(s),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  s.child = child;
  s.containerId = `local-${process.pid}-${child.pid}`;
  setState(s.id, "starting");

  const write = (d) => {
    try {
      fs.writeSync(log, d);
    } catch {}
  };
  child.stdout.on("data", (d) => write(d));
  child.stderr.on("data", (d) => {
    write(d);
    process.stderr.write(`[sandbox ${s.id}] ${d.toString()}`);
  });
  child.on("error", (e) => {
    write(`spawn error: ${e?.stack || e?.message || String(e)}\n`);
    try {
      fs.closeSync(log);
    } catch {}
    if (get(s.id) === s) {
      setState(s.id, "error", e?.message || String(e));
      broadcast(s.id, { type: "status", value: "error", message: e?.message || String(e) });
      closeEventStreams(s.id);
    }
    s.child = null;
  });
  child.on("exit", (code, signal) => {
    try {
      fs.closeSync(log);
    } catch {}
    if (s.child === child) s.child = null;
    const s2 = get(s.id);
    if (!s2) return;
    if (["starting", "ready", "busy"].includes(s2.state)) {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      setState(s.id, "error", `runner exited unexpectedly (${detail})`);
      broadcast(s.id, { type: "status", value: "error", message: `runner exited (${detail})` });
      broadcast(s.id, { type: "error", message: `Runner process exited unexpectedly (${detail}).` });
      closeEventStreams(s.id);
    }
  });
}

function startBrowser(s) {
  killChild(s.browser);
  s.browser = null;
  const log = fs.openSync(path.join(SANDBOX_DIR, s.id, "browser.log"), "a");
  const argv = confine([process.execPath, BROWSER_DAEMON], s.workspaceDir);
  const child = spawn(argv[0], argv.slice(1), {
    cwd: s.workspaceDir,
    env: sandboxEnv(s, { DAEMON_PORT: String(process.env.DAEMON_PORT || 18787) }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  s.browser = child;
  const write = (d) => {
    try {
      fs.writeSync(log, d);
    } catch {}
  };
  child.stdout.on("data", (d) => write(d));
  child.stderr.on("data", (d) => {
    write(d);
    process.stderr.write(`[sandbox ${s.id}] browser: ${d.toString()}`);
  });
  const cleanup = () => {
    try {
      fs.closeSync(log);
    } catch {}
    if (s.browser === child) s.browser = null;
  };
  child.on("error", (e) => {
    write(`browser spawn error: ${e?.stack || e?.message || String(e)}\n`);
    cleanup();
  });
  child.on("exit", cleanup);
  return { ok: true, pid: child.pid };
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

async function createContainer(id, body) {
  const s = get(id);
  if (!s) throw new Error("unknown sandbox");
  const support = sandboxSupport();
  if (!support.ok) throw new Error(`SANDBOX_UNAVAILABLE: ${support.error}`);

  s.image = body.image || DEFAULT_IMAGE;
  s.label = body.label || "sandbox";
  s.runnerSpec = body.runner || null;
  s.rawEnv = typeof body.env === "object" && body.env ? body.env : {};
  prepareWorkspace(s);
  s.env = sandboxEnv(s);

  if (s.runnerSpec) startRunner(s);
  else setState(id, "ready");
  return snapshot(s);
}

async function killContainer(id) {
  const s = get(id);
  if (!s) return;
  killChild(s.child);
  killChild(s.browser);
  s.child = null;
  s.browser = null;
  setState(id, "stopped");
  closeEventStreams(id);
}

async function startContainer(id) {
  const s = get(id);
  if (!s) return;
  if (s.runnerSpec) startRunner(s);
  else setState(id, "ready");
}

function safeJoin(workspaceDir, rel) {
  const target = path.resolve(workspaceDir, rel || ".");
  if (target !== workspaceDir && !target.startsWith(workspaceDir + path.sep)) {
    throw new Error("path escapes workspace");
  }
  return target;
}

function listDir(dir, base, out, depth = 0) {
  if (depth > 4) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) =>
    a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
  );
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (e.isDirectory()) {
      out.push({ name: e.name + "/", path: rel, type: "dir", size: 0, mtime: statMtime(full) });
      listDir(full, base, out, depth + 1);
    } else if (e.isFile()) {
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      out.push({ name: e.name, path: rel, type: "file", size: st.size, mtime: st.mtimeMs });
    }
  }
}

function statMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function execCommand(id, command, opts = {}) {
  const s = get(id);
  if (!s) throw new Error("sandbox not found");
  const support = sandboxSupport();
  if (!support.ok) throw new Error(`SANDBOX_UNAVAILABLE: ${support.error}`);
  const argv = confine(["bash", "-lc", command], s.workspaceDir);
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: s.workspaceDir,
      env: s.env || sandboxEnv(s),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(new Error("command timed out"));
    }, opts.timeout || 120_000);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ output: stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

function sse(res, id) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "access-control-allow-origin": "*",
  });
  res.write(": connected\n\n");
  const s = get(id);
  if (!s) {
    res.end(": no sandbox\n\n");
    return;
  }
  s.events.add(res);
  const keepAlive = setInterval(() => {
    try {
      res.write(": ka\n\n");
    } catch {
      clearInterval(keepAlive);
    }
  }, 15_000);
  res.on("close", () => {
    clearInterval(keepAlive);
    s.events.delete(res);
  });
}

function broadcast(id, obj) {
  const s = get(id);
  if (!s) return;
  for (const res of s.events) {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {}
  }
}

function closeEventStreams(id) {
  const s = get(id);
  if (!s) return;
  for (const res of s.events) {
    try {
      res.write("data: {\"type\":\"close\"}\n\n");
      res.end();
    } catch {}
  }
  s.events.clear();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 64 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
}

const HOST = process.env.SANDBOX_BIND_HOST || "127.0.0.1";

const server = http.createServer(async (req, res) => {
  // Only the Next app (which has authenticated the user) may drive sandboxes.
  if (SECRET && req.headers["x-sandbox-secret"] !== SECRET) {
    return json(res, 401, { error: "unauthorized" });
  }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method;
  const id = parts[1];
  const op = parts[2];

  try {
    if (method === "GET" && parts[0] === "health") {
      const b = sandboxSupport();
      json(res, 200, {
        ok: b.ok,
        docker: false,
        backend: b.backend || "local",
        version: b.version || null,
        error: b.error,
        images: [],
        activeContainers: [...sandboxes.values()].filter((s) => s.child || s.browser).length,
      });
      return;
    }

    if (method === "POST" && parts[0] === "containers" && !id) {
      const body = await readJson(req);
      const sid = body.id || randomUUID().slice(0, 8);
      const s = makeSandbox(sid);
      sandboxes.set(sid, s);
      const snap = await createContainer(sid, body);
      json(res, 201, snap);
      return;
    }

    if (method === "GET" && parts[0] === "containers" && !id) {
      json(res, 200, [...sandboxes.values()].map(snapshot));
      return;
    }

    if (parts[0] === "containers" && id) {
      const s = get(id);
      if (!s && op !== "events" && op !== "screenshot") {
        json(res, 404, { error: "sandbox not found" });
        return;
      }

      if (method === "GET" && op === "events") {
        sse(res, id);
        return;
      }

      if (method === "POST" && op === "start") {
        await startContainer(id);
        json(res, 200, { ok: true });
        return;
      }
      if (method === "POST" && op === "kill") {
        await killContainer(id);
        json(res, 200, { ok: true });
        return;
      }
      if (method === "POST" && op === "browser-daemon") {
        json(res, 200, startBrowser(s));
        return;
      }

      if (method === "DELETE") {
        await killContainer(id);
        closeEventStreams(id);
        sandboxes.delete(id);
        try {
          fs.rmSync(path.join(SANDBOX_DIR, id), { recursive: true, force: true });
        } catch {}
        json(res, 200, { ok: true });
        return;
      }

      if (method === "POST" && op === "exec") {
        const body = await readJson(req);
        const { output, stderr, exitCode } = await execCommand(id, body.command, {
          timeout: body.timeout || 120_000,
        });
        json(res, 200, { output, stderr, exitCode });
        return;
      }

      if (method === "POST" && op === "write") {
        const body = await readJson(req);
        if (!body.path || !body.path.startsWith("/workspace")) {
          json(res, 400, { error: "path must be under /workspace" });
          return;
        }
        const target = safeJoin(s.workspaceDir, body.path.replace(/^\/workspace\/?/, ""));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body.content ?? "", "utf8");
        json(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && op === "read") {
        const rel = (url.searchParams.get("path") || "/workspace").replace(/^\/workspace\/?/, "");
        const target = safeJoin(s.workspaceDir, rel);
        if (!fs.existsSync(target)) {
          json(res, 404, { error: "file not found" });
          return;
        }
        const buf = fs.readFileSync(target);
        json(res, 200, { content: buf.subarray(0, 2 * 1024 * 1024).toString("utf8") });
        return;
      }

      if (method === "GET" && op === "list") {
        const rel = (url.searchParams.get("path") || "/workspace").replace(/^\/workspace\/?/, "");
        const target = safeJoin(s.workspaceDir, rel);
        const out = [];
        listDir(target, target, out);
        json(res, 200, { files: out });
        return;
      }

      if (method === "GET" && op === "download") {
        const rel = (url.searchParams.get("path") || "/workspace/out").replace(/^\/workspace\/?/, "");
        const target = safeJoin(s.workspaceDir, rel);
        if (!fs.existsSync(target)) {
          json(res, 404, { error: "file not found" });
          return;
        }
        const buf = fs.readFileSync(target);
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${encodeURIComponent(path.basename(target))}"`,
          "access-control-allow-origin": "*",
        });
        res.end(buf);
        return;
      }

      if (method === "GET" && op === "screenshot") {
        json(res, 200, { image: s?.lastScreenshot || null });
        return;
      }
    }

    if (method === "POST" && parts[0] === "agent-events" && id) {
      const body = await readJson(req);
      const events = Array.isArray(body) ? body : Array.isArray(body.events) ? body.events : [body];
      let terminal = false;
      for (const evt of events) {
        if (!evt || typeof evt.type !== "string") continue;
        if (evt.type === "screenshot") {
          if (typeof evt.image === "string" && evt.image.length < 4 * 1024 * 1024) {
            const s = get(id);
            if (s) s.lastScreenshot = evt.image;
          }
          continue;
        }
        if (evt.type === "status") {
          const s = get(id);
          if (s) {
            if (evt.value === "done") {
              s.state = "idle";
              terminal = true;
            } else if (evt.value === "error") {
              s.state = "error";
              s.error = evt.message || evt.error || "runner error";
              terminal = true;
            } else if (evt.value === "running" || evt.value === "busy") {
              s.state = "busy";
            } else if (evt.value === "ready") {
              s.state = "ready";
            }
          }
        }
        if (
          evt.type === "log" ||
          evt.type === "thinking" ||
          evt.type === "tool" ||
          evt.type === "file" ||
          evt.type === "text" ||
          evt.type === "error" ||
          evt.type === "done" ||
          evt.type === "progress" ||
          evt.type === "status"
        ) {
          if (evt.type === "done" || evt.type === "error") terminal = true;
          broadcast(id, evt);
        }
      }
      if (terminal) closeEventStreams(id);
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[sandbox] listening on http://${HOST}:${PORT}`);
  const b = sandboxSupport();
  console.log(b.ok ? `[sandbox] ${b.backend} ${b.version} (workspace-write)` : `[sandbox] NOT available: ${b.error}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log("\n[sandbox] shutting down");
    for (const s of sandboxes.values()) {
      killChild(s.child);
      killChild(s.browser);
    }
    process.exit(0);
  });
}
