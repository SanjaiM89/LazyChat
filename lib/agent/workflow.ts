import vm from "node:vm";

import { appendEvent } from "@/lib/agent/session";
import { validateSchema } from "@/lib/agent/json-schema";

export { validateSchema };

/**
 * The workflow engine.
 *
 * A workflow is a JavaScript program the model writes to fan work out across
 * many agents. It runs in a bare realm: no `require`, no `process`, no
 * filesystem, no network, no timers. The only things it can reach are the hooks
 * it is given — the agents do the work, the script only arranges it.
 *
 * The hooks are the harness's:
 *   agent(prompt, opts?)      run one subagent to completion
 *   pipeline(items, ...stages) run each item through the stages, no barrier
 *   parallel(thunks)          run thunks concurrently and wait for all
 *   phase(title)              start a progress phase
 *   log(message)              narrate progress
 *   args                      the tool call's args, verbatim
 */

export interface WorkflowAgentOptions {
  label?: string;
  phase?: string;
  provider?: string;
  model?: string;
  /** A JSON Schema; the child's answer is validated against it. */
  schema?: Record<string, unknown>;
}

export interface WorkflowAgentCall {
  prompt: string;
  options: WorkflowAgentOptions;
}

export interface WorkflowHooks {
  /** Run one agent and return its answer. */
  agent: (prompt: string, options: WorkflowAgentOptions) => Promise<unknown>;
  /** Record a phase or a log line. */
  note: (kind: "phase" | "log", message: string) => void;
}

export interface WorkflowResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  phases: string[];
  logs: string[];
  /** The agent calls the script made, in order. */
  calls: Array<{ prompt: string; label?: string; phase?: string }>;
}

/**
 * Evaluate a workflow script.
 *
 * @param timeoutMs how long the whole script may run.
 */
export async function runWorkflowScript(
  script: string,
  args: Record<string, unknown>,
  hooks: WorkflowHooks,
  opts: { timeoutMs?: number } = {},
): Promise<WorkflowResult> {
  const phases: string[] = [];
  const logs: string[] = [];
  const calls: WorkflowResult["calls"] = [];

  const agent = async (prompt: unknown, options: unknown): Promise<unknown> => {
    const text = String(prompt ?? "");
    const opts = (options ?? {}) as WorkflowAgentOptions;
    if (typeof opts !== "object" || opts === null) {
      throw new Error("agent(prompt, opts) needs an options object.");
    }
    if (opts.schema !== undefined && !isPlainObject(opts.schema)) {
      throw new Error("agent() only accepts a JSON Schema object.");
    }
    calls.push({ prompt: text, label: opts.label, phase: opts.phase });
    return hooks.agent(text, opts);
  };

  const pipeline = async (items: unknown, ...stages: unknown[]): Promise<unknown[]> => {
    if (!Array.isArray(items)) throw new Error("pipeline() needs an array of items.");
    for (const stage of stages) {
      if (typeof stage !== "function") throw new Error("pipeline() stages must be functions.");
    }
    return Promise.all(
      items.map(async (item, index) => {
        let previous = item;
        for (const stage of stages as Array<(prev: unknown, item: unknown, index: number) => unknown>) {
          try {
            previous = await stage(previous, item, index);
          } catch {
            // A stage that throws drops this item, and its remaining stages
            // never run.
            return null;
          }
        }
        return previous;
      }),
    );
  };

  const parallel = async (thunks: unknown): Promise<unknown[]> => {
    if (!Array.isArray(thunks)) throw new Error("parallel() needs an array of functions.");
    return Promise.all(
      thunks.map(async (thunk) => {
        if (typeof thunk !== "function") throw new Error("parallel() takes functions.");
        try {
          return await thunk();
        } catch {
          return null;
        }
      }),
    );
  };

  const context = vm.createContext({
    agent,
    pipeline,
    parallel,
    phase: (title: unknown) => hooks.note("phase", String(title ?? "")),
    log: (message: unknown) => hooks.note("log", String(message ?? "")),
    args,
    // The script has no console; log() is the way to say something.
  });

  const timeoutMs = opts.timeoutMs ?? 120_000;
  try {
    const evaluated = vm.runInContext(script, context, { filename: "workflow.js" });
    const value = await withTimeout(
      Promise.resolve(evaluated),
      timeoutMs,
      "The workflow did not finish in time.",
    );
    return { ok: true, value: materialize(value), phases, logs, calls };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      phases,
      logs,
      calls,
    };
  }
}

/** Copy a value out of the realm, so nothing from it leaks into the app. */
function materialize(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// The JSON Schema subset
// ---------------------------------------------------------------------------


/** Record a workflow event. */
export function workflowEvent(
  type:
    | "tool-workflow/run-start"
    | "tool-workflow/agent-start"
    | "tool-workflow/agent-end"
    | "tool-workflow/run-end",
  data: Record<string, unknown>,
  ctx: { conversationId: string; runId?: string },
): void {
  appendEvent(type, data, {
    conversationId: ctx.conversationId,
    runId: ctx.runId ?? null,
  });
}
