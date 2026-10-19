/**
 * Hang-proofing tests: a wedged FalkorDB connection must slow a request down,
 * never block it forever.
 *
 * Regression for the "prompt not responding" bug — the process-wide connection
 * promise never settled, `recallForOmnia()` awaited it before the model was
 * called, and every chat run (plus every brain-backed route) stalled at
 * "Working" with no error for the life of the dev server.
 *
 * Run: `npm run test:brain`
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

import { msFromEnv, withBudget, withTimeout } from "../../lib/brain/timeout";
import { FalkorClient } from "../../lib/brain/graph";
import { ensureReady } from "../../lib/brain/bootstrap";

const CONN_KEY = Symbol.for("lazychat.brain.falkordb");
const READY_KEY = Symbol.for("lazychat.brain.ready");
const store = globalThis as unknown as Record<symbol, unknown>;

/** The wedged state: a cached promise that never settles. */
function poisonConnection(): void {
  store[CONN_KEY] = { promise: new Promise(() => {}) };
}

function poisonCleanup(): void {
  delete store[CONN_KEY];
  delete store[READY_KEY];
  delete process.env.BRAIN_CONNECT_TIMEOUT_MS;
  delete process.env.BRAIN_BOOTSTRAP_TIMEOUT_MS;
}

after(poisonCleanup);

describe("msFromEnv", () => {
  it("uses the environment value when it is a positive number", () => {
    process.env.BRAIN_TEST_MS = "1500";
    try {
      assert.equal(msFromEnv("BRAIN_TEST_MS", 99), 1500);
    } finally {
      delete process.env.BRAIN_TEST_MS;
    }
  });

  it("falls back when the variable is missing or nonsense", () => {
    delete process.env.BRAIN_TEST_MS;
    assert.equal(msFromEnv("BRAIN_TEST_MS", 99), 99);
    process.env.BRAIN_TEST_MS = "-5";
    try {
      assert.equal(msFromEnv("BRAIN_TEST_MS", 99), 99);
    } finally {
      delete process.env.BRAIN_TEST_MS;
    }
  });
});

describe("withTimeout", () => {
  it("resolves with the value when the work finishes first", async () => {
    assert.equal(await withTimeout(Promise.resolve("ok"), 1_000, "fast"), "ok");
  });

  it("propagates a rejection from the work", async () => {
    await assert.rejects(
      () => withTimeout(Promise.reject(new Error("boom")), 1_000, "fast"),
      /boom/,
    );
  });

  it("gives up at the deadline instead of waiting on hung work", async () => {
    const started = Date.now();
    await assert.rejects(
      () => withTimeout(new Promise(() => {}), 60, "hung work"),
      /hung work timed out after 60ms/,
    );
    assert.ok(Date.now() - started < 1_500, "the deadline must fire");
  });

  it("takes over rejection handling of the abandoned work", async () => {
    let unhandled = false;
    const onUnhandled = () => {
      unhandled = true;
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const late = new Promise((_, reject) => setTimeout(() => reject(new Error("late boom")), 60));
      await assert.rejects(() => withTimeout(late, 10, "slow"));
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(unhandled, false, "a late rejection must not escape");
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });
});

describe("withBudget", () => {
  it("returns the value when the work finishes in time", async () => {
    assert.equal(await withBudget(Promise.resolve(7), 1_000, 0), 7);
  });

  it("expires into the fallback instead of throwing", async () => {
    assert.equal(await withBudget(new Promise(() => {}), 30, "fallback"), "fallback");
  });
});

describe("FalkorClient.get() with a wedged connection", () => {
  it("rejects at the deadline and forgets the poisoned entry", async () => {
    process.env.BRAIN_CONNECT_TIMEOUT_MS = "200";
    poisonConnection();
    const started = Date.now();
    await assert.rejects(() => FalkorClient.get(), /FalkorDB connect timed out/);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2_000, `get() settled after ${elapsed}ms, expected ~200ms`);
    assert.equal(store[CONN_KEY], undefined, "the wedged entry must be evicted so the next caller retries");
    poisonCleanup();
  });
});

describe("ensureReady() with a wedged connection", () => {
  it("resolves instead of holding the caller on a stuck bootstrap", async () => {
    process.env.BRAIN_CONNECT_TIMEOUT_MS = "700";
    process.env.BRAIN_BOOTSTRAP_TIMEOUT_MS = "150";
    poisonConnection();
    const started = Date.now();
    await ensureReady(); // the whole point: this must not hang
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 600, `ensureReady returned after ${elapsed}ms, expected ~150ms`);
    assert.equal(store[READY_KEY], undefined, "a timed-out bootstrap must be retryable");
    // Let the abandoned connect attempt settle before the suite exits.
    await new Promise((resolve) => setTimeout(resolve, 800));
    poisonCleanup();
  });
});
