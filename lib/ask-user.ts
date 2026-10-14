/**
 * Ask-user question registry.
 *
 * The model asks the user a question mid-turn and the turn continues with the
 * answer, which is what DeepSeek Harness' `ask_user_question` does: the tool
 * pauses until a human answers, then feeds the answer back into the loop as an
 * ordinary tool result (cf. `packages/interaction/tool-ask-user`).
 *
 * The pause works because a tool `execute` runs *during* the stream, so the
 * chat request stays open while this registry holds the promise open. The
 * browser answers over a second request, which resolves it.
 *
 * Questions are keyed by tool call id, not by a separate id: the transcript
 * already shows the pending call, so the client can answer with the id it
 * already has, and a reload can re-derive it.
 */

/** One question as the model authored it. */
export interface AskQuestion {
  /** Stable id within the call; echoed back in the answer. */
  id: string;
  /** The question text shown to the user. */
  question: string;
  /** Optional short heading ("Confirm", "Choose mode"). */
  header?: string;
  /** Optional choices. */
  options?: Array<{ label: string; description?: string }>;
  /** Whether the user may pick more than one option. */
  multiSelect?: boolean;
}

/** One answered question. */
export interface AskAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

export type AskUserStatus = "pending" | "answered" | "cancelled" | "expired";

export interface PendingQuestion {
  toolCallId: string;
  conversationId: string;
  questions: AskQuestion[];
  status: AskUserStatus;
  answers?: AskAnswer[];
  askedAt: number;
}

/**
 * How long a question waits before the model is released anyway.
 *
 * The user may close the tab, reload, or walk away. Without this the tool call
 * would hold the run open forever and the turn would never settle. On expiry
 * the model receives an empty answer set, which the tool description tells it
 * to read as "the user did not answer" — never as approval.
 */
const QUESTION_TTL_MS = 10 * 60 * 1000;

interface PendingEntry {
  record: PendingQuestion;
  /** Every caller awaiting this question; all of them release together. */
  waiters: Array<(answers: AskAnswer[]) => void>;
  timer: NodeJS.Timeout | undefined;
}

/**
 * Process-wide registry state.
 *
 * Next compiles each route as its own bundle, so a module-level `Map` is
 * per-route: the question the chat stream opens would live in a different copy
 * from the one the answer endpoint reads, and every answer would come back
 * "not awaiting an answer". Pinning to `globalThis` makes the registry one per
 * process, which is what a blocking tool call requires — the request that asked
 * and the request that answers have to meet.
 */
interface RegistryState {
  pending: Map<string, PendingEntry>;
  runCancels: Map<string, Set<() => void>>;
}

const GLOBAL_KEY = "__omniaAskUserRegistry";

function state(): RegistryState {
  const g = globalThis as unknown as Record<string, RegistryState | undefined>;
  const existing = g[GLOBAL_KEY];
  if (existing) return existing;
  const fresh: RegistryState = { pending: new Map(), runCancels: new Map() };
  g[GLOBAL_KEY] = fresh;
  return fresh;
}

const pending = state().pending;

/** Reap settled and expired entries so the map cannot grow without bound. */
function sweep(now = Date.now()): void {
  for (const [id, entry] of pending) {
    const stale =
      entry.record.status !== "pending" ||
      now - entry.record.askedAt > QUESTION_TTL_MS;
    if (stale) clearEntry(id, entry);
  }
}

function clearEntry(id: string, entry: PendingEntry): void {
  if (entry.timer) clearTimeout(entry.timer);
  pending.delete(id);
}

/**
 * Register a question and wait for the user's answer.
 *
 * Never rejects: a cancelled or expired question resolves with an empty answer
 * list so the model loop continues rather than failing the turn.
 *
 * @param toolCallId the transcript's tool call id — the client's answer key.
 * @param conversationId the conversation the question belongs to.
 * @param questions the questions to ask.
 * @param runId owning run, so stopping it cancels outstanding questions.
 * @returns the user's answers, one entry per question the model asked.
 */
export function askUser(
  toolCallId: string,
  conversationId: string,
  questions: AskQuestion[],
  runId?: string,
): Promise<AskAnswer[]> {
  sweep();
  const existing = pending.get(toolCallId);
  if (existing) {
    // A resumed run re-executes the same call. Join the wait already in
    // progress instead of registering a second question the user cannot see:
    // both callers release together, so neither the original nor the resumed
    // execution is left holding the model.
    return new Promise<AskAnswer[]>((resolve) => existing.waiters.push(resolve));
  }

  return new Promise<AskAnswer[]>((resolve) => {
    const record: PendingQuestion = {
      toolCallId,
      conversationId,
      questions,
      status: "pending",
      askedAt: Date.now(),
    };
    const entry: PendingEntry = { record, waiters: [resolve], timer: undefined };
    const settle = (answers: AskAnswer[]) => {
      clearEntry(toolCallId, entry);
      const waiters = entry.waiters.splice(0);
      for (const waiter of waiters) waiter(answers);
    };
    entry.timer = setTimeout(() => {
      record.status = "expired";
      settle([]);
    }, QUESTION_TTL_MS);
    entry.timer.unref?.();
    if (runId) {
      // Cancelling the run releases the model even if the user never answers.
      onRunStopped(runId, () => {
        record.status = "cancelled";
        settle([]);
      });
    }
    pending.set(toolCallId, entry);
  });
}

/**
 * Answer a pending question.
 * @returns the stored record, or null when the id is unknown or already settled.
 */
export function answerUser(
  toolCallId: string,
  answers: AskAnswer[],
): PendingQuestion | null {
  sweep();
  const entry = pending.get(toolCallId);
  if (!entry || entry.record.status !== "pending") return null;
  entry.record.status = "answered";
  entry.record.answers = answers;
  const waiters = entry.waiters.splice(0);
  clearEntry(toolCallId, entry);
  for (const waiter of waiters) waiter(answers);
  return entry.record;
}

/** Read a question's current state, for a client that reloaded mid-question. */
export function getQuestion(toolCallId: string): PendingQuestion | null {
  sweep();
  return pending.get(toolCallId)?.record ?? null;
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

/** Listeners keyed by run id, registered while a run owns a question. */
const runCancels = state().runCancels;

function onRunStopped(runId: string, fn: () => void): void {
  const set = runCancels.get(runId) ?? new Set();
  set.add(fn);
  runCancels.set(runId, set);
}

/**
 * Release every question a run is holding. Called when a run stops or is
 * aborted, so a cancelled turn never leaves the model waiting.
 */
export function cancelRunQuestions(runId: string): void {
  const set = runCancels.get(runId);
  if (set) {
    for (const fn of set) fn();
    runCancels.delete(runId);
  }
}

/** Drop this module's bookkeeping for a finished run. */
export function forgetRun(runId: string): void {
  runCancels.delete(runId);
}