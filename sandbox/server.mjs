#!/usr/bin/env node
/**
 * Omnia sandbox service.
 *
 * Host-side HTTP service that provisions Docker containers ("sandboxes"),
 * streams their live screens + agent events to the Next.js app, and proxies
 * file/terminal access. The in-container runner (sandbox/container/runner.mjs)
 * POSTs agent events + screenshots back to us via http://host.docker.internal.
 *
 * Run:   node sandbox/server.mjs          (listens on 0.0.0.0:8787)
 * Env:   SANDBOX_PORT (default 8787), DATA_DIR (default ./data)
 *
 * Zero runtime deps — Node built-ins only.
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.SANDBOX_PORT || 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const IMAGE_DEFAULT = process.env.SANDBOX_IMAGE || "omnia-sandbox:latest";
const SANDBOX_DIR = path.join(DATA_DIR, "sandboxes");
fs.mkdirSync(SANDBOX_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

const sandboxes = new Map(); // id -> Sandbox

function makeSandbox(id) {
  return {
    id,
    containerId: null,
    image: IMAGE_DEFAULT,
    label: "sandbox",
    state: "starting", // starting | ready | busy | idle | error | stopped
    hasBrowser: true,
    error: null,
    createdAt: Date.now(),
    workspaceDir: path.join(SANDBOX_DIR, id, "workspace"),
    events: new Set(), // SSE response writers
    lastScreenshot: null,
    env: {},
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

/* ------------------------------------------------------------------ */
/*  Docker helpers                                                     */
/* ------------------------------------------------------------------ */

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...opts });
}

function dockerOk() {
  const r = docker(["info", "--format", "{{.ServerVersion}}"]);
  return r.status === 0 ? { ok: true, version: (r.stdout || "").trim() } : { ok: false, error: (r.stderr || "").trim().split("\n")[0] };
}

function runningImages() {
  const r = docker(["images", "--format", "{{.Repository}}:{{.Tag}}"]);
  if (r.status !== 0) return [];
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** True when the image exists locally (no pull attempted). */
function imageExists(image) {
  const r = docker(["image", "inspect", image], { timeout: 15_000 });
  return r.status === 0;
}

/** Strip docker's generic trailing hint so the real cause stays visible. */
function cleanDockerError(stderr, stdout) {
  const raw = (stderr || stdout || "").trim();
  if (!raw) return "unknown docker error";
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^Run 'docker .* --help'/.test(l));
  return lines.join("\n") || raw;
}

function activeContainers() {
  const r = docker(["ps", "-q", "--filter", "name=omnia-"]);
  return r.status === 0 ? (r.stdout || "").split("\n").filter(Boolean).length : 0;
}

/* ------------------------------------------------------------------ */
/*  Env passthrough for the container                                  */
/* ------------------------------------------------------------------ */

const ENV_RE =
  /^(AGENT|OMNIA|ANTHROPIC|OPENAI|GOOGLE|GEMINI|OLLAMA|LMSTUDIO|DEEPSEEK|GROQ|XAI|MISTRAL|OPENROUTER|AZURE|GITHUB|FIREWORKS|TOGETHER|NVIDIA|AWS|SANDBOX|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)_|_API_KEY$|_BASE_URL$|_API_KEY_ID$|_SECRET$|_TOKEN$/i;

/**
 * Build the container environment from the env the Next.js app passed us
 * (body.env), filtered to provider-relevant vars. Containers run with
 * --network host, so "localhost" inside the container IS the host — local
 * providers (Ollama, LM Studio) are reached directly, no gateway rewrite.
 */
function envForContainer(bodyEnv = {}, extra = {}) {
  const source = typeof bodyEnv === "object" && bodyEnv ? bodyEnv : process.env;
  const env = {};
  for (const [k, v] of Object.entries(source)) {
    if (!v || typeof v !== "string") continue;
    if (ENV_RE.test(k)) env[k] = v;
  }
  Object.assign(env, extra);
  return env;
}

/* ------------------------------------------------------------------ */
/*  Container create / lifecycle                                       */
/* ------------------------------------------------------------------ */

/** Write container env to a file for `docker run --env-file` (robust against
 *  multiline values like AGENT_TASK, quotes, `$`, etc.). Returns the file path. */
function writeEnvFile(id, env) {
  const dir = path.join(SANDBOX_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "container.env");
  const lines = [];
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    // env-file format: no quoting needed except escaping newlines/backslashes.
    const safe = String(v).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "");
    lines.push(`${k}=${safe}`);
  }
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return file;
}

/** Create a container from the sandbox image. Returns {id, containerId}. */
async function createContainer(id, body) {
  const s = get(id);
  if (!s) throw new Error("unknown sandbox");
  s.image = body.image || IMAGE_DEFAULT;
  s.label = body.label || "sandbox";
  s.workspaceDir = path.join(SANDBOX_DIR, id, "workspace");
  fs.mkdirSync(s.workspaceDir, { recursive: true });
  fs.mkdirSync(path.join(s.workspaceDir, "out"), { recursive: true });

  // Fail fast with an actionable message instead of docker's cryptic
  // "pull access denied … Run 'docker run --help'" when the image was never built.
  if (!imageExists(s.image)) {
    throw new Error(
      `sandbox image "${s.image}" not found locally. Build it first: npm run sandbox:build (docker build -t ${s.image} sandbox/container)`,
    );
  }

  const env = envForContainer(body.env, {
    AGENT_TASK: body.runner?.task || "",
    SANDBOX_HOST: `http://127.0.0.1:${PORT}`,
    SANDBOX_ID: id,
    SANDBOX_LABEL: s.label,
  });

  const name = `omnia-${id}`;
  // A previous run may have left a stopped container with the same name —
  // remove it first so `docker run --name` doesn't conflict.
  docker(["rm", "-f", name], { timeout: 20_000 });

  const envFile = writeEnvFile(id, env);
  const runArgs = [
    "run", "-d",
    "--name", name,
    "--network", "host",
    "-m", "4g",
    "--cpus", "2",
    "--env-file", envFile,
    "-v", `${s.workspaceDir}:/workspace`,
    "-w", "/workspace",
  ];
  runArgs.push(s.image);
  if (body.runner) {
    runArgs.push("node", "/app/runner.mjs", id, body.runner.provider, body.runner.model, body.runner.engine || "tool-loop");
  }

  const r = spawnSync("docker", runArgs, { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) {
    const detail = cleanDockerError(r.stderr, r.stdout);
    console.error(`[sandbox] docker run failed for ${name}: ${detail}`);
    throw new Error(`docker run failed: ${detail}`);
  }
  const containerId = (r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean).pop() || "";
  if (!containerId) throw new Error("docker run produced no container id");
  s.containerId = containerId;
  setState(id, "starting");
  watchContainerExit(id);
  return snapshot(s);
}

async function killContainer(id) {
  const s = get(id);
  if (!s || !s.containerId) return;
  docker(["rm", "-f", s.containerId], { timeout: 20_000 });
  setState(id, "stopped");
  closeEventStreams(id);
}

async function startContainer(id) {
  const s = get(id);
  if (!s || !s.containerId) return;
  docker(["start", s.containerId]);
  setState(id, "starting");
}

/* ------------------------------------------------------------------ */
/*  Workspace file access (host side of the /workspace volume)         */
/* ------------------------------------------------------------------ */

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
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
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

/* ------------------------------------------------------------------ */
/*  Exec (terminal / tool shell inside the container)                  */
/* ------------------------------------------------------------------ */

function execCommand(id, command, opts = {}) {
  const s = get(id);
  if (!s || !s.containerId) throw new Error("sandbox not running");
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-w", "/workspace", s.containerId, "sh", "-lc", command], {
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
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

/* ------------------------------------------------------------------ */
/*  SSE plumbing                                                       */
/* ------------------------------------------------------------------ */

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
    } catch {
      /* ignore */
    }
  }
}

/** End all open SSE responses for a container (terminal state reached). */
function closeEventStreams(id) {
  const s = get(id);
  if (!s) return;
  for (const res of s.events) {
    try {
      res.write("data: {\"type\":\"close\"}\n\n");
      res.end();
    } catch {
      /* ignore */
    }
  }
  s.events.clear();
}

/** Watch the container's exit so a crashed runner can't leave a sandbox dangling. */
function watchContainerExit(id) {
  const s = get(id);
  if (!s || !s.containerId) return;
  const child = spawn("docker", ["wait", s.containerId]);
  let code = "";
  child.stdout.on("data", (d) => (code += d.toString()));
  child.on("error", () => {});
  child.on("close", () => {
    const s2 = get(id);
    if (!s2) return;
    // "idle" means the runner finished and closed cleanly (status:done was
    // processed before the container exited). Only flag it as an error if it
    // exited while the runner was still actively working.
    if (["starting", "ready", "busy"].includes(s2.state)) {
      const exitCode = code.trim();
      setState(id, "error", `container exited unexpectedly (code ${exitCode})`);
      broadcast(id, { type: "status", value: "error", message: `runner exited (code ${exitCode})` });
      broadcast(id, { type: "error", message: `Runner process exited unexpectedly (code ${exitCode}).` });
      closeEventStreams(id);
    }
  });
}

/* ------------------------------------------------------------------ */
/*  HTTP server                                                        */
/* ------------------------------------------------------------------ */

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method;
  const id = parts[1];
  const op = parts[2];

  try {
    /* ---- health ---- */
    if (method === "GET" && parts[0] === "health") {
      const d = dockerOk();
      json(res, 200, {
        ok: d.ok,
        docker: d.ok,
        version: d.version,
        error: d.error,
        images: d.ok ? runningImages() : [],
        activeContainers: d.ok ? activeContainers() : 0,
      });
      return;
    }

    /* ---- create container ---- */
    if (method === "POST" && parts[0] === "containers" && !id) {
      const body = await readJson(req);
      const sid = body.id || randomUUID().slice(0, 8);
      const s = makeSandbox(sid);
      sandboxes.set(sid, s);
      const snap = await createContainer(sid, body);
      json(res, 201, snap);
      return;
    }

    /* ---- list ---- */
    if (method === "GET" && parts[0] === "containers" && !id) {
      json(res, 200, [...sandboxes.values()].map(snapshot));
      return;
    }

    /* ---- container-scoped ops ---- */
    if (parts[0] === "containers" && id) {
      const s = get(id);
      if (!s && op !== "events" && op !== "screenshot") {
        json(res, 404, { error: "sandbox not found" });
        return;
      }

      /* events (SSE) */
      if (method === "GET" && op === "events") {
        sse(res, id);
        return;
      }

      /* start / kill */
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

      /* delete — kill the container and drop the sandbox record entirely.
         Used by the agent orchestrator to clean up a finished run. */
      if (method === "DELETE") {
        const s = get(id);
        if (s && s.containerId) docker(["rm", "-f", s.containerId], { timeout: 20_000 });
        closeEventStreams(id);
        sandboxes.delete(id);
        json(res, 200, { ok: true });
        return;
      }

      /* exec */
      if (method === "POST" && op === "exec") {
        const body = await readJson(req);
        const { output, stderr, exitCode } = await execCommand(id, body.command, {
          timeout: body.timeout || 120_000,
        });
        json(res, 200, { output, stderr, exitCode });
        return;
      }

      /* write */
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

      /* read */
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

      /* list */
      if (method === "GET" && op === "list") {
        const rel = (url.searchParams.get("path") || "/workspace").replace(/^\/workspace\/?/, "");
        const target = safeJoin(s.workspaceDir, rel);
        const out = [];
        listDir(target, target, out);
        json(res, 200, { files: out });
        return;
      }

      /* download */
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

      /* screenshot */
      if (method === "GET" && op === "screenshot") {
        json(res, 200, { image: s.lastScreenshot || null });
        return;
      }
    }

    /* ---- agent event ingestion from inside the container ---- */
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
        // state tracking
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
        if (evt.type === "log" || evt.type === "thinking" || evt.type === "tool" ||
            evt.type === "file" || evt.type === "text" || evt.type === "error" ||
            evt.type === "done" || evt.type === "progress" || evt.type === "status") {
          if (evt.type === "done" || evt.type === "error") terminal = true;
          broadcast(id, evt);
        }
      }
      if (terminal) {
        // close any waiting event streams (the orchestrator stops reading on done)
        closeEventStreams(id);
      }
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[sandbox] listening on http://0.0.0.0:${PORT}`);
  const d = dockerOk();
  console.log(d.ok ? `[sandbox] docker ready (${d.version})` : `[sandbox] docker NOT available: ${d.error}`);
});

// graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log("\n[sandbox] shutting down");
    process.exit(0);
  });
}
