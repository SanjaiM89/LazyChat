import { test } from "node:test";
import assert from "node:assert/strict";

import { getJob, jobOutput, killJob, listJobs, startJob } from "@/lib/agent/jobs";

const conversationId = "jobs-test";

function waitFor(id: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const job = getJob(id);
      if (job && job.status !== "running") return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("the job did not finish"));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test("a job runs and its output is kept", async () => {
  const job = startJob({
    conversationId,
    title: "echo",
    command: "echo job-output-marker",
    cwd: process.cwd(),
  });
  await waitFor(job.id);
  const record = getJob(job.id);
  assert.equal(record?.status, "done");
  assert.match(record?.output ?? "", /job-output-marker/);
  assert.match(jobOutput(job.id)?.output ?? "", /job-output-marker/);
});

test("a failing job is marked failed", async () => {
  const job = startJob({
    conversationId,
    title: "fails",
    command: "exit 7",
    cwd: process.cwd(),
  });
  await waitFor(job.id);
  const record = getJob(job.id);
  assert.equal(record?.status, "failed");
  assert.equal(record?.exitCode, 7);
});

test("jobs are listed for their conversation", async () => {
  const before = listJobs(conversationId).length;
  const job = startJob({
    conversationId,
    title: "listed",
    command: "true",
    cwd: process.cwd(),
  });
  await waitFor(job.id);
  assert.equal(listJobs(conversationId).length, before + 1);
});

test("a running job can be killed", async () => {
  const job = startJob({
    conversationId,
    title: "sleeps",
    command: "sleep 30",
    cwd: process.cwd(),
  });
  assert.equal(killJob(job.id), true);
  const record = getJob(job.id);
  assert.equal(record?.status, "killed");
  assert.equal(killJob("job-nope"), false);
});
