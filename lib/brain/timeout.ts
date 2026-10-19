/**
 * Bounded awaits for best-effort infrastructure.
 *
 * FalkorDB is optional context for a chat, so a slow graph may cost a request
 * time but must never make it wait forever. The driver makes that easy to get
 * wrong: node-redis queues commands while reconnecting and keeps `connect()`
 * pending through its retry strategy, so an unbounded `await` can outlive the
 * process — which is exactly how one dropped connection stalled every chat run
 * (memory recall runs before the model is called, and both the connection and
 * the bootstrap promises are cached process-wide).
 *
 * Two shapes cover the call sites:
 *   withTimeout — wants the value or an error (connect, query, bootstrap);
 *   withBudget  — wants the value or a fallback (recall, workspace briefing).
 *
 * Both settle within `ms` and take over rejection handling of the abandoned
 * work, so a late failure can never surface as an unhandled rejection.
 */

/** Read a positive millisecond budget from the environment, with a fallback. */
export function msFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** Resolve with the work's value, or reject with `${label} timed out after ${ms}ms`. */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // The clock may have won the race; make sure the abandoned work cannot
    // reject into the void later.
    work.catch(() => {});
  }
}

/** Like withTimeout, but a deadline expires into `fallback` instead of an error. */
export async function withBudget<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  try {
    return await withTimeout(work, ms, "operation");
  } catch {
    return fallback;
  }
}
