import { spawn, type ChildProcess } from "node:child_process";
import { nanoid } from "nanoid";

/**
 * Durable background jobs.
 *
 * A job is work the model started and did not wait for: a long build, a test
 * run, a watch process. The job record survives a restart of the server, so a
 * job that is still running when the app comes back is still there — its
 * output is kept, and the model can ask for it later.
 */

export type JobStatus = "running" | "done" | "failed" | "killed";

export interface JobRecord {
  id: string;
  /** The conversation that started it. */
  conversationId: string;
  /** The label the model gave it. */
  title: string;
  command: string;
  cwd: string;
  status: JobStatus;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
  /** The output produced so far. */
  output: string;
  /** Whether the output was cut to fit. */
  truncated: boolean;
}

const MAX_OUTPUT = 256 * 1024;
const MAX_JOBS = 100;

/** The jobs, and the processes behind the running ones. */
const jobs = new Map<string, JobRecord>();
const processes = new Map<string, ChildProcess>();

function trim(record: JobRecord): void {
  if (record.output.length <= MAX_OUTPUT) return;
  record.output = record.output.slice(-MAX_OUTPUT);
  record.truncated = true;
}

/** Start a job. The command runs detached from the model's turn. */
export function startJob(input: {
  conversationId: string;
  title: string;
  command: string;
  cwd: string;
  shell?: string;
  /** Run this instead of a shell command. */
  run?: () => Promise<{ output: string; exitCode?: number }>;
}): JobRecord {
  reapJobs();
  const id = `job-${nanoid(8)}`;
  const record: JobRecord = {
    id,
    conversationId: input.conversationId,
    title: input.title || input.command,
    command: input.command,
    cwd: input.cwd,
    status: "running",
    startedAt: Date.now(),
    output: "",
    truncated: false,
  };
  jobs.set(id, record);

  if (input.run) {
    // The work is the app's own, not a command: run it here and keep its
    // output on the job.
    void input
      .run()
      .then((result) => {
        const current = jobs.get(id);
        if (!current) return;
        current.output += result.output ?? "";
        trim(current);
        current.status = result.exitCode === 0 || result.exitCode === undefined ? "done" : "failed";
        current.exitCode = result.exitCode;
        current.endedAt = Date.now();
      })
      .catch((err) => {
        const current = jobs.get(id);
        if (!current) return;
        current.output += `\n${(err as Error).message}\n`;
        trim(current);
        current.status = "failed";
        current.exitCode = 1;
        current.endedAt = Date.now();
      });
    return record;
  }

  const proc = spawn(input.shell ?? "bash", ["--norc", "--noprofile", "-c", input.command], {
    cwd: input.cwd,
    env: { ...process.env, TERM: "dumb" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.set(id, proc);
  proc.unref();

  const onData = (chunk: Buffer) => {
    const current = jobs.get(id);
    if (!current) return;
    current.output += chunk.toString("utf8");
    trim(current);
  };
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  proc.on("exit", (code, signal) => {
    const current = jobs.get(id);
    processes.delete(id);
    if (!current) return;
    current.status = signal ? "killed" : code === 0 ? "done" : "failed";
    current.exitCode = code ?? undefined;
    current.endedAt = Date.now();
  });
  proc.on("error", (err) => {
    const current = jobs.get(id);
    processes.delete(id);
    if (!current) return;
    current.status = "failed";
    current.output += `\n${err.message}\n`;
    current.endedAt = Date.now();
  });

  return record;
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

/** The jobs of one conversation, newest first. */
export function listJobs(conversationId?: string): JobRecord[] {
  return [...jobs.values()]
    .filter((job) => !conversationId || job.conversationId === conversationId)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** The output of a job, optionally only what is new since `since`. */
export function jobOutput(id: string, since = 0): { output: string; truncated: boolean } | null {
  const job = jobs.get(id);
  if (!job) return null;
  return { output: job.output.slice(since), truncated: job.truncated };
}

/** Stop a running job. */
export function killJob(id: string): boolean {
  const proc = processes.get(id);
  const job = jobs.get(id);
  if (!job) return false;
  if (proc) {
    try {
      proc.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    processes.delete(id);
  }
  job.status = "killed";
  job.endedAt = Date.now();
  return true;
}

/** Drop the finished jobs that nobody is looking at any more. */
export function reapJobs(maxAgeMs = 60 * 60 * 1000): number {
  const now = Date.now();
  let removed = 0;
  for (const job of [...jobs.values()]) {
    if (job.status === "running") continue;
    if (now - (job.endedAt ?? job.startedAt) < maxAgeMs) continue;
    jobs.delete(job.id);
    removed++;
  }
  // Keep the registry bounded even when every job is fresh.
  if (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
    if (oldest) {
      jobs.delete(oldest.id);
      removed++;
    }
  }
  return removed;
}

/** How many jobs are running. */
export function runningJobCount(): number {
  return processes.size;
}
