/**
 * Lazy startup bootstrap for the Company Brain.
 *
 * Replaces the FastAPI lifespan hook: installs indexes and seeded procedural
 * memory idempotently, once per server process. A failure never throws —
 * `/api/brain/health` reports the outage instead of the process refusing
 * to start.
 */
import { FalkorClient } from "./graph";
import { installProcedures } from "./memory/consolidation";
import { initSchema } from "./schema";

const READY_KEY = Symbol.for("lazychat.brain.ready");

type ReadyState = { promise: Promise<void> };

/** Ensure indexes + seeded procedures exist. Safe to call per request. */
export function ensureReady(): Promise<void> {
  const store = globalThis as unknown as Record<symbol, ReadyState | undefined>;
  let state = store[READY_KEY];
  if (!state) {
    state = { promise: bootstrap() };
    store[READY_KEY] = state;
  }
  return state.promise;
}

async function bootstrap(): Promise<void> {
  try {
    const client = await FalkorClient.get();
    await initSchema(client);
    await installProcedures(client);
  } catch (err) {
    console.error(`[brain] startup bootstrap failed (is FalkorDB running?): ${(err as Error).message}`);
  }
}
