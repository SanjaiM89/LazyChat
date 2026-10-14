
/**
 * Agent-run bridge: spawn DeepSeek Harness headless runs inside a workspace.
 *
 * Each run records a dsh session id under the workspace (membership by cwd),
 * streams the runner's JSONL events to the execution panel, and persists the
 * command, output, and outcome as workspace memory.
 *
 * Nothing here touches the chat UI — runs live in the Workspace view.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { FalkorClient } from "@/lib/brain/graph";
import { getWorkspace, recordSession, endSession } from "./workspaces";
import { buildMemoryContext, recordCommandRun } from "./memory";
import { writeRunPatch } from "./overlay";
import type { AgentRun } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function runId(): string {
  return `run:${Math.random().toString(16).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function dshBin(): string {
  // Built CLI inside the vendored checkout; falls back to npx resolution.
  const local = path.resolve(process.cwd(), "harness/deepseek-harness/apps/cli/lib/bin.js");
  if (fs.existsSync(local)) return local;
  return "dsh";
}

export interface SpawnedRun {
  run: AgentRun;
  /** Live output chunks (also appended to the persisted CommandRun). */
  output: string[];
}

const liveRuns = new Map<string, { proc: ChildProcess; output: string[]; run: AgentRun }>();

export function getLiveRun(id: string) {
  return liveRuns.get(id);
}

/**
 * Start one headless agent run: `dsh --profile headless <task>` with
 * cwd=workspace path and our memory MCP servers patched in.
 */
export async function spawnAgentRun(
  client: FalkorClient,
  workspaceId: string,
  task: string,
  opts: { sessionId?: string } = {},
): Promise<SpawnedRun> {
  const ws = await getWorkspace(client, workspaceId);
  if (!ws) throw new Error(`Unknown workspace '${workspaceId}'.`);
  if (!fs.existsSync(ws.path) || !fs.statSync(ws.path).isDirectory()) {
    throw new Error(`Workspace directory is missing: ${ws.path}`);
  }
  const cleanTask = task.trim().slice(0, 8000);
  if (!cleanTask) throw new Error("Task is required.");

  // Relevant memory rides in the prompt: shared global first, then workspace.
  const memoryBlock = await buildMemoryContext(client, workspaceId);
  const prompt = memoryBlock ? `${memoryBlock}\n\n## Task\n${cleanTask}` : cleanTask;

  const id = runId();
  const patchFile = await writeRunPatch();
  const bin = dshBin();
  // NOTE: --session-id ADOPTS a persisted dsh session and refuses unknown ids,
  // so it is only passed when resuming. Fresh runs omit it; the runner reports
  // its session id in the opening `session` JSONL event, which we adopt below.
  const adopt = opts.sessionId ? ["--session-id", opts.sessionId] : [];
  const args = ["--profile", "headless", "--patch", patchFile, ...adopt, "--json", prompt];
  const proc = bin === "dsh" ? spawn("dsh", args, { cwd: ws.path }) : spawn(process.execPath, [bin, ...args], { cwd: ws.path });

  const run: AgentRun = {
    id,
    workspace_id: workspaceId,
    session_id: opts.sessionId ?? "",
    task: cleanTask,
    status: "running",
    pid: proc.pid,
    started_at: nowIso(),
  };
  const output: string[] = [];
  liveRuns.set(id, { proc, output, run });

  // Adopt the dsh-reported session id for fresh runs (membership by cwd).
  let adopted = Boolean(opts.sessionId);
  if (adopted) {
    await recordSession(client, workspaceId, run.session_id, cleanTask.slice(0, 200));
  }
  const maybeAdopt = () => {
    if (adopted) return;
    const m = /"type"\s*:\s*"session"[^{}]*"sessionId"\s*:\s*"([^"]+)"/.exec(output.join(""));
    if (m) {
      adopted = true;
      run.session_id = m[1];
      void recordSession(client, workspaceId, m[1], cleanTask.slice(0, 200)).catch(() => {});
    }
  };

  const started = Date.now();
  proc.stdout?.on("data", (chunk: Buffer) => {
    output.push(chunk.toString());
    if (output.join("").length > 200_000) output.splice(0, output.length - 200);
    maybeAdopt();
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    output.push(chunk.toString());
  });
  proc.on("close", (code) => {
    const entry = liveRuns.get(id);
    const full = (entry?.output ?? []).join("").slice(-12000);
    run.status = code === 0 ? "done" : "failed";
    run.exit_code = code ?? 1;
    run.ended_at = nowIso();
    void (async () => {
      try {
        const c = await FalkorClient.get();
        await recordCommandRun(c, workspaceId, `dsh agent run: ${cleanTask.slice(0, 200)}`, full, run.exit_code ?? 1, Date.now() - started, run.session_id || undefined, id);
        if (run.session_id) await endSession(c, run.session_id, code === 0 ? "ended" : "failed");
      } catch {
        // persistence must never crash the runner callback
      } finally {
        liveRuns.delete(id);
      }
    })();
  });
  proc.on("error", () => {
    run.status = "failed";
    run.exit_code = 127;
    run.ended_at = nowIso();
    liveRuns.delete(id);
    if (run.session_id) void endSession(client, run.session_id, "failed").catch(() => {});
  });

  return { run, output };
}

export async function stopAgentRun(id: string): Promise<boolean> {
  const entry = liveRuns.get(id);
  if (!entry) return false;
  entry.run.status = "stopped";
  entry.run.ended_at = nowIso();
  try {
    entry.proc.kill("SIGTERM");
  } catch {
    return false;
  }
  return true;
}
