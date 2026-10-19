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
import { msFromEnv, withTimeout } from "./timeout";

const READY_KEY = Symbol.for("lazychat.brain.ready");

type ReadyState = { promise: Promise<void> };

/**
 * Ensure indexes + seeded procedures exist. Safe to call per request.
 *
 * The bootstrap promise is bounded and dropped when it expires: a graph that
 * never answers must cost a request a few seconds at most, and the next caller
 * must be able to start over instead of awaiting a promise that stays pending
 * for the life of the process (which froze chat runs — `pump()` recalls memory
 * before the model is ever called — and every FalkorDB-backed route).
 */
export function ensureReady(): Promise<void> {
  const store = globalThis as unknown as Record<symbol, ReadyState | undefined>;
  let state = store[READY_KEY];
  if (!state) {
    const entry: ReadyState = { promise: Promise.resolve() };
    entry.promise = (async () => {
      try {
        await withTimeout(
          bootstrap(),
          msFromEnv("BRAIN_BOOTSTRAP_TIMEOUT_MS", 6_000),
          "brain bootstrap",
        );
      } catch (err) {
        // bootstrap() logs its own failures; a timeout just means the graph is
        // slow or wedged. Serve the request without memory rather than hold it
        // open, and let the next caller start a fresh bootstrap.
        console.warn(`[brain] ${err instanceof Error ? err.message : String(err)} — continuing without graph`);
        if (store[READY_KEY] === entry) store[READY_KEY] = undefined;
      }
    })();
    store[READY_KEY] = entry;
    state = entry;
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
