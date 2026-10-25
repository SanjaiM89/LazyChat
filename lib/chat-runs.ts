import "server-only";

import {
  convertToModelMessages,
  isStepCount,
  readUIMessageStream,
  streamText,
  toUIMessageStream,
  APICallError,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { nanoid } from "nanoid";

import {
  DEFAULT_SETTINGS,
  type ChatRunStatus,
  type ChatRunSummary,
  type ChatSettings,
} from "@/lib/types";
import { buildLanguageModel, thinkingProviderOptions } from "@/lib/providers";
import { getOpencodeTransport } from "@/lib/models";
import { isGoalRoundPrompt } from "@/lib/goal-model";
import { enabledTools } from "@/lib/tools";
import { cancelRunQuestions, forgetRun } from "@/lib/ask-user";
import { buildMCPToolSet } from "@/lib/mcp";
import { buildSystemPrompt } from "@/lib/system";
import { captureOmniaMemory, messageText, recallForOmnia, recordOmniaTurn } from "@/lib/brain/omnia-memory";
import { msFromEnv, withBudget } from "@/lib/brain/timeout";
// Start the schedule/reminder scheduler on server boot.
import { startScheduler, getPendingReminders, clearPendingReminder } from "@/lib/schedules";
void startScheduler();

/**
 * The workspace briefing sits on the chat's critical path — tools and system
 * prompt are both built before the model is called — so it carries the same
 * budget as memory recall: optional context may be slow, it may never block.
 */
async function budgetedBriefing(run: ChatRunRecord) {
  if (!run.workspaceId) return null;
  const { workspaceBriefing } = await import("@/lib/workspace/tools");
  return withBudget(
    workspaceBriefing(run.workspaceId),
    msFromEnv("BRAIN_PREP_BUDGET_MS", 6_000),
    null,
  );
}

/**
 * Workspace attachment for a run: folder-bound tools + memory briefing.
 * No-ops (empty tools, unchanged prompt) when nothing is attached or the
 * workspace is gone — a detached folder must never break a chat.
 */
async function buildRunWorkspaceTools(
  run: ChatRunRecord,
  brief: { root: string; name?: string } | null,
  sessionDir?: SessionDirectory,
  recorder?: WorkspaceChangeRecorder | null,
): Promise<Record<string, unknown>> {
  if (!run.workspaceId || !brief) return {};
  try {
    const { buildWorkspaceTools } = await import("@/lib/workspace/tools");
    // The root follows the session, so a `working_directory` move relocates
    // the file tools with the shells.
    return buildWorkspaceTools({
      workspaceId: run.workspaceId,
      root: sessionDir ? () => sessionDir.cwd : brief.root,
      // The session owns the file observations: the read-before-write policy
      // is per session, and it is never persisted.
      sessionId: run.id,
      onBeforeWrite: recorder ? (target: string) => recorder?.captureBefore(target) : undefined,
    }) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function withWorkspaceBriefing(
  run: ChatRunRecord,
  system: string,
  brief: { briefing: string; root: string } | null,
): Promise<string> {
  if (!run.workspaceId || !brief) return system;
  return (
    system +
    "\n\n## Attached workspace\n" +
    brief.briefing +
    "\nPrefer the ws_* tools for anything involving the project files or commands." +
    "\nThe working directory above is the session's own: `working_directory` moves it, and every file and " +
    "shell tool follows. " +
    "\nAs you work, keep the workspace memory current without being asked: " +
    "record key decisions and error fixes with ws_remember, and track multi-step " +
    "work with ws_todo (add/list/done). Shell runs and file writes are recorded automatically."
  );
}
import { getArtifact, readArtifactBuffer } from "@/lib/artifacts";
import { getConversation, getConversationMeta, saveConversation } from "@/lib/store";
import { currentUser } from "@/lib/auth/context";
import { HEARTBEAT_CHUNK, coalesceChunks, formatFrame } from "@/lib/sse";
import { guardTools } from "@/lib/agent/guard";
import { guardResults } from "@/lib/agent/result-guard";
import { createSessionDirectory, type SessionDirectory } from "@/lib/agent/session-dir";
import type { WorkspaceChangeRecorder } from "@/lib/agent/workspace-changes";
import { contextPressure, measureMessages } from "@/lib/agent/token-meter";
import { appendEvent, listEvents } from "@/lib/agent/session";
import { buildAgentTools } from "@/lib/agent/tools";
import { disabledToolNames, readPluginState } from "@/lib/agent/plugins";
import {
  COMPACT_THRESHOLD_RATIO,
  compactConversation,
  isContextOverflow,
  isImageBudgetError,
  MAX_OVERFLOW_RETRIES,
  offloadImages,
} from "@/lib/agent/compaction";
import {
  DEFAULT_PERMISSIONS,
  type PermissionSettings,
} from "@/lib/agent/permissions";


export interface ChatRunRecord {
  id: string;
  /** Firebase uid / org of the user who started this run. */
  ownerId?: string;
  orgId?: string | null;
  conversationId?: string;
  /** Attached workspace (folder-bound execution + memory scope), if any. */
  workspaceId?: string;
  /** The session's working directory. It survives the turn and the restart. */
  cwd?: string;
  status: ChatRunStatus;
  activity: string;
  step: number;
  messageId: string;
  requestMessages: UIMessage[];
  history: UIMessage[];
  settings: ChatSettings;
  /** What this session may do without asking. */
  permissions: PermissionSettings;
  /** Tools this run may not use. */
  excludeTools: string[];
  model?: LanguageModel;
  chunks: UIMessageChunk[];
  /** The answer text streamed so far, for the session log. */
  answerText: string;
  toolNames: Map<string, string>;
  listeners: Set<() => void>;
  abort: AbortController;
  done: Promise<void>;
  startedAt: number;
  updatedAt: number;
  error?: string;
  aborted?: boolean;
  /** First response token arrival (for tokens/sec). */
  firstTokenAt?: number;
  /** When the step in flight started. */
  stepStartedAt?: number;
  /** When the step in flight produced its first token. */
  stepFirstTokenAt?: number;
  /** Raw char counts as a fallback when the provider reports no usage. */
  inputChars?: number;
  outputChars?: number;
  /** Settled model usage for the finished run. */
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  lastCheckpoint: number;
  writeChain: Promise<void>;
  replayable: boolean;
}

const runs = new Map<string, ChatRunRecord>();

const KEEP_FINISHED_MS = 10 * 60 * 1000;

const CHECKPOINT_MS = 4000;

const TOOL_ACTIVITY: Record<string, string> = {
  web_search: "Searching the web…",
  createArtifact: "Creating an artifact…",
  runAgentTask: "Running a sandbox agent…",
  computer_navigate: "Using the computer…",
  computer_search: "Searching Google…",
  computer_click: "Using the computer…",
  computer_type: "Using the computer…",
  computer_press: "Using the keyboard…",
  computer_scroll: "Scrolling…",
  computer_read: "Reading the browser…",
  computer_screenshot: "Looking at the browser…",
  computer_nav: "Using the computer…",
  ws_glob: "Finding files…",
  ws_grep: "Searching files…",
  ws_read: "Reading a file…",
  ws_write: "Writing a file…",
  ws_shell: "Running a command…",
  ws_todo: "Updating TODOs…",
  ws_remember: "Recording memory…",
  ws_str_replace_editor: "Editing a file…",
  ws_read_image: "Reading an image…",
  session_search: "Searching conversations…",
  session_event_read: "Reading history…",
  create_goal: "Setting a goal…",
  get_goal: "Checking goal…",
  update_goal: "Updating goal…",
  render_ui: "Building interface…",
  generate_document: "Writing document…",
  search_ui_components: "Looking up UI components…",
  schedule_create: "Scheduling reminder…",
  schedule_list: "Listing reminders…",
  schedule_delete: "Deleting reminder…",
  schedule_update: "Updating reminder…",
  exit_plan_mode: "Submitting plan…",
};

function isTerminal(status: ChatRunStatus): boolean {
  return status === "done" || status === "failed" || status === "stopped";
}

function summary(r: ChatRunRecord): ChatRunSummary {
  return {
    id: r.id,
    conversationId: r.conversationId,
    status: r.status,
    activity: r.activity,
    step: r.step,
    messageId: r.messageId,
    provider: r.settings.provider,
    model: r.settings.model,
    startedAt: r.startedAt,
    updatedAt: r.updatedAt,
    error: r.error,
    replayable: r.replayable,
  };
}

function emit(r: ChatRunRecord) {
  r.updatedAt = Date.now();
  for (const fn of r.listeners) {
    try {
      fn();
    } catch {
    }
  }
}

export function getChatRun(id: string): ChatRunSummary | null {
  const r = runs.get(id);
  return r ? summary(r) : null;
}

export function getRunOwner(id: string): string | undefined {
  return runs.get(id)?.ownerId;
}

/** The promise that settles when a run is finished. */
export function chatRunDone(id: string): Promise<void> {
  return runs.get(id)?.done ?? Promise.resolve();
}

export function listChatRuns(conversationId?: string, ownerId?: string): ChatRunSummary[] {
  return [...runs.values()]
    .filter((r) => !conversationId || r.conversationId === conversationId)
    .filter((r) => !ownerId || r.ownerId === ownerId)
    .map(summary)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function activeChatRuns(conversationId?: string): ChatRunSummary[] {
  return listChatRuns(conversationId).filter((r) => r.status === "running");
}

export function subscribeChatRun(id: string, fn: () => void): () => void {
  const r = runs.get(id);
  if (!r) return () => {};
  r.listeners.add(fn);
  return () => r.listeners.delete(fn);
}

export function cleanupChatRuns(maxAgeMs = KEEP_FINISHED_MS): number {
  let removed = 0;
  for (const [id, r] of runs) {
    if (isTerminal(r.status) && Date.now() - r.updatedAt > maxAgeMs) {
      runs.delete(id);
      removed++;
    }
  }
  return removed;
}


export interface CreateChatRunInput {
  messages: UIMessage[];
  settings?: Partial<ChatSettings>;
  /** Sandbox mode + approval policy for this run. */
  permissions?: Partial<PermissionSettings>;
  /** Tools this run may not use — a subagent may not spawn another one. */
  excludeTools?: string[];
  model?: LanguageModel;
  conversationId?: string;
  trigger?: "submit-message" | "regenerate-message";
  workspaceId?: string;
  owner?: { uid: string; orgId: string | null };
}

export async function prepareChatRun(
  settings?: Partial<ChatSettings>,
): Promise<{ settings: ChatSettings; model: LanguageModel }> {
  const merged: ChatSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const model = await buildLanguageModel({
    provider: merged.provider,
    model: merged.model,
  });
  return { settings: merged, model };
}

export class ChatRunConflictError extends Error {
  readonly activeRunId: string;
  constructor(activeRunId: string) {
    super("This conversation is already generating a reply.");
    this.activeRunId = activeRunId;
  }
}

// A tool part counts as complete only when it carries an output.
function hasToolOutput(p: any): boolean {
  if (!p || typeof p.type !== "string") return true;
  if (p.type === "dynamic-tool" || p.type.startsWith("tool-")) {
    return (
      p.state === "output-available" ||
      p.state === "output-error" ||
      p.state === "output-denied"
    );
  }
  if (p.type === "tool-invocation") {
    return p.toolInvocation?.state === "result";
  }
  return true;
}

// Drop tool calls that never produced a result (interrupted turns), so
// convertToModelMessages never throws AI_MissingToolResultsError. Assistant
// messages left with no parts at all are dropped; user messages are kept.
function sanitizeToolHistory(messages: UIMessage[]): UIMessage[] {
  const out: UIMessage[] = [];
  for (const m of messages) {
    const parts = (m as any)?.parts;
    if (!m || !Array.isArray(parts)) {
      if (m) out.push(m);
      continue;
    }
    const kept = parts.filter(hasToolOutput);
    if ((m as any).role === "assistant" && kept.length === 0) continue;
    out.push(kept.length === parts.length ? m : ({ ...(m as any), parts: kept } as UIMessage));
  }
  return out;
}

export async function createChatRun(input: CreateChatRunInput): Promise<ChatRunRecord> {
  const settings: ChatSettings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
  const conversationId = input.conversationId;
  const owner = input.owner ?? (currentUser() ? { uid: currentUser()!.uid, orgId: currentUser()!.orgId } : undefined);
  if (conversationId && owner) {
    // null both when absent and when someone else owns it (the rules answer 403): either way we may proceed,
    // and saving over another user's id is rejected by Firestore (or parked in the owner's outbox when
    // Firestore is unreachable). This read is a discarded preflight, so a network failure here must
    // never block starting a chat — the save path carries the real ownership guard.
    await getConversationMeta(conversationId, owner.uid).catch(() => null);
  }
  if (conversationId) {
    const live = activeChatRuns(conversationId)[0];
    if (live) throw new ChatRunConflictError(live.id);
  }

  // Inject any pending reminders as a system message at run start.
  let requestMessages = sanitizeToolHistory(input.messages || []);
  if (conversationId) {
    const pending = await getPendingReminders(conversationId);
    if (pending.length > 0) {
      for (const r of pending) {
        void clearPendingReminder(r.id);
      }
      const reminderText = pending
        .map((r) => `🔔 Reminder: ${r.title}\n${r.prompt}`)
        .join("\n\n");
      const reminderMsg: UIMessage = {
        role: "system",
        id: nanoid(12),
        parts: [{ type: "text", text: `Pending reminders for this session:\n\n${reminderText}` }],
      } as any;
      requestMessages = [reminderMsg, ...requestMessages];
    }
  }
  if (!requestMessages.length) throw new Error("No messages.");

  const last = requestMessages[requestMessages.length - 1];
  const isContinuation = last?.role === "assistant";
  const messageId = isContinuation ? last.id : nanoid(12);

  // The session resumes in the directory it was last in, so a conversation
  // keeps its place in the project across turns and restarts.
  const stored = conversationId ? await getConversationMeta(conversationId, owner?.uid) : null;

  const run: ChatRunRecord = {
    id: nanoid(10),
    ownerId: owner?.uid,
    orgId: owner?.orgId ?? null,
    conversationId,
    workspaceId: input.workspaceId,
    cwd: stored?.cwd,
    status: "running",
    activity: "Starting…",
    step: 0,
    messageId,
    requestMessages,
    history: isContinuation ? requestMessages.slice(0, -1) : requestMessages,
    settings,
    permissions: { ...DEFAULT_PERMISSIONS, ...(input.permissions || {}) },
    excludeTools: input.excludeTools ?? [],
    model: input.model,
    chunks: [],
    answerText: "",
    toolNames: new Map(),
    listeners: new Set(),
    abort: new AbortController(),
    done: Promise.resolve(),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    lastCheckpoint: 0,
    writeChain: Promise.resolve(),
    replayable: true,
  };
  runs.set(run.id, run);

  void checkpoint(run, true);

  run.done = pump(run);
  return run;
}

export async function stopChatRun(id: string): Promise<boolean> {
  const run = runs.get(id);
  if (!run) return false;
  if (isTerminal(run.status)) return true;
  run.aborted = true;
  run.activity = "Stopping…";
  emit(run);
  // A human stop also stops goal execution: dsh disarms the goal when the
  // host pauses, so the next turn does not silently resume unattended rounds.
  if (run.conversationId) {
    void import("@/lib/goals")
      .then(({ disarmGoal }) => disarmGoal(run.conversationId!))
      .catch(() => {});
  }
  // A run waiting on an ask-user question would otherwise hold the model (and
  // this process) open long after the user pressed stop.
  void cancelRunQuestions(id);
  try {
    run.abort.abort();
  } catch {
  }
  const watchdog = setTimeout(() => {
    if (run.status === "running") void finishRun(run, "stopped", undefined);
  }, 5000);
  (watchdog as any).unref?.();
  return true;
}


async function pump(run: ChatRunRecord) {
  const { settings } = run;
  try {
    const model =
      run.model ??
      (await buildLanguageModel({
        provider: settings.provider,
        model: settings.model,
      }));
    run.model = model;

    const goalRound = (() => {
      const lastUser = [...run.requestMessages]
        .reverse()
        .find((message) => message.role === "user");
      return lastUser ? isGoalRoundPrompt(messageText(lastUser)) : false;
    })();

    const brief = await budgetedBriefing(run);
    const pluginState = await readPluginState();
    const disabled = disabledToolNames(pluginState);
    // The session's working directory: it starts where the last turn left it,
    // else in the attached workspace, else wherever the process runs. Every
    // directory-bound tool follows it, and `working_directory` moves it.
    const sessionDir = createSessionDirectory(run.cwd ?? brief?.root ?? process.cwd());
    run.cwd = sessionDir.cwd;
    // The permission preset belongs to the session's record: a change is
    // logged, so the history shows what the session was allowed to do.
    if (run.conversationId) {
      const last = listEvents(run.conversationId, { types: ["permission/preset"], limit: 1 })[0];
      const previous = last?.data as { mode?: string; policy?: string } | undefined;
      if (
        !previous ||
        previous.mode !== run.permissions.mode ||
        previous.policy !== run.permissions.policy
      ) {
        appendEvent(
          "permission/preset",
          { mode: run.permissions.mode, policy: run.permissions.policy },
          { conversationId: run.conversationId, runId: run.id },
        );
      }
    }
    // The program a `code_run` call runs gets the same guarded tools, minus
    // itself — a program must not be able to run another program.
    const programTools: { tools: Record<string, unknown> } = { tools: {} };
    const agentTools = buildAgentTools({
      conversationId: run.conversationId,
      cwd: sessionDir.cwd,
      sessionDir,
      programTools: () => programTools.tools,
      settings: run.settings,
      permissions: run.permissions,
      parentRunId: run.id,
      workspaceId: run.workspaceId,
      onCwdChange: (dir) => {
        run.cwd = dir;
        const eventCtx = run.conversationId ? { conversationId: run.conversationId, runId: run.id } : null;
        if (eventCtx) appendEvent("working-directory/change", { cwd: dir }, eventCtx);
      },
    });
    // The turn's change recorder: the working tree is snapshotted so the
    // summary names what this turn changed, not what was already there.
    let recorder: WorkspaceChangeRecorder | null = null;
    if (run.workspaceId && brief) {
      try {
        const { WorkspaceChangeRecorder: Recorder } = await import("@/lib/agent/workspace-changes");
        recorder = new Recorder(sessionDir ? sessionDir.cwd : brief.root);
        await recorder.begin(run.step + 1);
      } catch {
        recorder = null;
      }
    }
    const allTools = {
      ...enabledTools(settings.tools, {
        provider: settings.provider,
        model: settings.model,
        conversationId: run.conversationId,
        runId: run.id,
        goalRound,
      }),
      ...(await buildMCPToolSet()),
      ...(await buildRunWorkspaceTools(run, brief, sessionDir, recorder)),
      ...agentTools,
    };
    const tools = guardResults(
      guardTools(
        Object.fromEntries(
          Object.entries(allTools).filter(
            ([name]) => !disabled.has(name) && !run.excludeTools.includes(name),
          ),
        ),
        {
          conversationId: run.conversationId ?? run.id,
          runId: run.id,
          settings: run.permissions,
          granted: new Set<string>(),
        },
      ),
      {
        conversationId: run.conversationId ?? run.id,
        runId: run.id,
      },
    );
    const { code_run: _codeRun, ...programVisible } = tools as Record<string, unknown>;
    programTools.tools = programVisible;

    let system = await buildSystemPrompt({
      provider: settings.provider,
      model: settings.model,
      conversationId: run.conversationId,
    });
    system = await withWorkspaceBriefing(run, system, brief);

    // FalkorDB memory: what earlier Omnia conversations established about this
    // question rides in the system prompt. Never throws; empty when unknown.
    const lastUserMessage = [...run.requestMessages].reverse().find((m) => m.role === "user");
    const remembered = lastUserMessage ? await recallForOmnia(messageText(lastUserMessage)) : "";
    const systemWithMemory = remembered ? system + remembered : system;

    const useThinking = settings.thinking;
    const providerOptions = thinkingProviderOptions(
      settings.provider,
      settings.model,
      useThinking,
    );
    const anthropicThinking =
      settings.provider === "anthropic" ||
      (settings.provider === "opencode" &&
        getOpencodeTransport(settings.model) === "anthropic");
    const temperature =
      useThinking && anthropicThinking
        ? undefined
        : settings.temperature;

    let modelMessages = await convertToModelMessages(
      await inlineLocalAttachments(run.requestMessages),
    );

    // The turn may not fit in the window. The meter measures the request
    // before it is sent, so the conversation is compacted up front rather
    // than after the provider refuses it.
    const measured = measureMessages(modelMessages as never);
    const pressure = contextPressure(measured.tokens, settings.provider, settings.model);
    if (pressure.ratio >= COMPACT_THRESHOLD_RATIO && run.conversationId) {
      const compacted = await compactConversation(run.conversationId, {
        force: true,
        runId: run.id,
      });
      if (compacted.compacted) {
        const refreshed = await getConversation(run.conversationId);
        if (refreshed?.messages?.length) {
          const history = await convertToModelMessages(
            await inlineLocalAttachments(refreshed.messages as UIMessage[]),
          );
          // The turn's own message is not in the stored conversation yet.
          const lastUser = [...run.requestMessages].reverse().find((m) => m.role === "user");
          const turn = lastUser
            ? await convertToModelMessages([lastUser] as UIMessage[])
            : [];
          modelMessages = turn.length ? [...history, ...turn] : history;
        }
      }
    }

    const eventCtx = run.conversationId
      ? { conversationId: run.conversationId, runId: run.id }
      : null;
    if (eventCtx) {
      appendEvent("turn/start", { step: run.step, provider: settings.provider, model: settings.model }, eventCtx);
      const lastUser = [...run.requestMessages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        appendEvent("user/message", { text: messageText(lastUser).slice(0, 4000) }, eventCtx);
      }
    }

    // A turn that does not fit is compacted and tried again; a request that
    // is refused over its image budget loses the oldest images and is tried
    // again. Two attempts is enough: a third would be a loop, not a recovery.
    let attempt = 0;
    let messages = modelMessages;
    for (;;) {
      try {
        const result = streamText({
          model,
          system: systemWithMemory,
          messages,
          tools,
          stopWhen: isStepCount(settings.maxSteps ?? 14),
          temperature,
          providerOptions: providerOptions as any,
          abortSignal: run.abort.signal,
        });
        // Char counts backstop the provider usage payload (some OpenAI-compatible
        // endpoints never send it) — ~4 chars/token.
        run.inputChars = systemWithMemory.length + JSON.stringify(messages).length;

        const stream = toUIMessageStream({
          stream: result.stream,
          tools,
          sendReasoning: true,
          sendSources: true,
          sendStart: true,
          originalMessages: run.requestMessages,
          generateMessageId: () => run.messageId,
          onError: describeStreamError,
        });

        await consumeStream(run, stream);
        await captureUsage(run, result);
        break;
      } catch (e: any) {
        const overflow = isContextOverflow(e);
        const imageBudget = isImageBudgetError(e);
        if (!(overflow || imageBudget) || attempt >= MAX_OVERFLOW_RETRIES || !run.conversationId) {
          throw e;
        }
        attempt += 1;
        if (overflow) {
          // Compact the conversation, then rebuild the request from it.
          await compactConversation(run.conversationId, { force: true, runId: run.id });
          const refreshed = await getConversation(run.conversationId);
          messages = refreshed?.messages
            ? await convertToModelMessages(
                await inlineLocalAttachments(refreshed.messages as UIMessage[]),
              )
            : messages;
        } else {
          const offloaded = offloadImages(messages, 0);
          messages = offloaded.messages;
          if (eventCtx) {
            appendEvent("image/offload", { offloaded: offloaded.offloaded }, eventCtx);
          }
        }
      }
    }

    if (recorder) {
      try {
        const summary = await recorder.end(run.step + 1);
        if (summary && eventCtx && (summary.files.length > 0 || summary.degraded)) {
          appendEvent("workspace/changes", summary as unknown as Record<string, unknown>, eventCtx);
        }
      } catch {
        // A summary that cannot be produced never fails the turn.
      } finally {
        recorder.dispose();
      }
    }

    const status: ChatRunStatus = run.aborted
      ? "stopped"
      : run.error
        ? "failed"
        : "done";
    if (eventCtx) {
      if (run.answerText) {
        appendEvent("assistant/message", { text: run.answerText.slice(0, 20000) }, eventCtx);
      }
      appendEvent("turn/end", { status }, eventCtx);
    }
    await finishRun(run, status, run.error);
  } catch (e: any) {
    const aborted = run.aborted || e?.name === "AbortError";
    console.error("[chat-run] failed:", {
      id: run.id,
      provider: settings.provider,
      model: settings.model,
      error: e?.message,
      status: e?.statusCode,
      body: String(e?.responseBody ?? "").slice(0, 500),
    });
    await finishRun(
      run,
      aborted ? "stopped" : "failed",
      e?.message || "Something went wrong while talking to the model.",
    );
  }
}

/**
 * Read the model's stream and push it to the client.
 *
 * The text and reasoning parts are opened here when the provider skipped the
 * start, so a part never appears without its beginning.
 */
async function consumeStream(
  run: ChatRunRecord,
  stream: ReadableStream<UIMessageChunk>,
): Promise<void> {
  const reader = stream.getReader();
  const activeTextParts = new Set<string>();
  const activeReasoningParts = new Set<string>();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const v = value as UIMessageChunk & { id?: string };
      if (v.type === "text-start" && v.id) activeTextParts.add(v.id);
      if (v.type === "text-delta" && v.id && !activeTextParts.has(v.id)) {
        pushChunk(run, { type: "text-start", id: v.id } as UIMessageChunk);
        activeTextParts.add(v.id);
      }
      if (v.type === "text-end" && v.id && !activeTextParts.has(v.id)) {
        continue;
      }
      if (v.type === "text-end" && v.id) activeTextParts.delete(v.id);

      if (v.type === "reasoning-start" && v.id) activeReasoningParts.add(v.id);
      if (v.type === "reasoning-delta" && v.id && !activeReasoningParts.has(v.id)) {
        pushChunk(run, { type: "reasoning-start", id: v.id } as UIMessageChunk);
        activeReasoningParts.add(v.id);
      }
      if (v.type === "reasoning-end" && v.id && !activeReasoningParts.has(v.id)) {
        continue;
      }
      if (v.type === "reasoning-end" && v.id) activeReasoningParts.delete(v.id);

      pushChunk(run, value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
}

function pushChunk(run: ChatRunRecord, chunk: UIMessageChunk) {
  if (chunk.type === "abort") run.aborted = true;
  if (chunk.type === "start-step") run.step += 1;
  if (chunk.type === "error") run.error = chunk.errorText;
  if (!run.firstTokenAt && (chunk.type === "text-delta" || chunk.type === "reasoning-delta")) {
    run.firstTokenAt = Date.now();
  }
  if (
    run.stepFirstTokenAt === undefined &&
    (chunk.type === "text-delta" || chunk.type === "reasoning-delta")
  ) {
    run.stepFirstTokenAt = Date.now();
  }
  if (chunk.type === "text-delta" && typeof (chunk as { delta?: unknown }).delta === "string") {
    run.outputChars = (run.outputChars ?? 0) + (chunk as { delta: string }).delta.length;
    run.answerText += (chunk as { delta: string }).delta;
  }

  // The session log records the shape of the turn, not every token: the
  // boundaries, the tool calls and their outcomes.
  if (run.conversationId) {
    const ctx = { conversationId: run.conversationId, runId: run.id };
    if (chunk.type === "start-step") {
      run.stepStartedAt = Date.now();
      run.stepFirstTokenAt = undefined;
      appendEvent("step/start", { step: run.step }, ctx);
    } else if (chunk.type === "finish-step") {
      // The step closed: its model time and its first-token latency.
      const started = run.stepStartedAt;
      const first = run.stepFirstTokenAt;
      appendEvent(
        "step/end",
        {
          step: run.step,
          llm_ms: started ? Date.now() - started : undefined,
          ttft_ms: started && first !== undefined ? first - started : undefined,
        },
        ctx,
      );
      run.stepStartedAt = undefined;
      run.stepFirstTokenAt = undefined;
    } else if (chunk.type === "tool-input-available") {
      appendEvent(
        "tool/call",
        { tool: chunk.toolName, toolCallId: chunk.toolCallId, input: chunk.input },
        ctx,
      );
    } else if (chunk.type === "tool-output-available") {
      appendEvent(
        "tool/result",
        {
          tool: run.toolNames.get(chunk.toolCallId),
          toolCallId: chunk.toolCallId,
          status: "completed",
        },
        ctx,
      );
    } else if (chunk.type === "tool-output-error") {
      appendEvent(
        "tool/result",
        {
          tool: run.toolNames.get(chunk.toolCallId),
          toolCallId: chunk.toolCallId,
          status: "error",
        },
        ctx,
      );
    }
  }

  run.chunks.push(chunk);
  const next = activityFor(run, chunk);
  if (next) run.activity = next;

  if (Date.now() - run.lastCheckpoint > CHECKPOINT_MS) void checkpoint(run, true);

  emit(run);
}

/**
 * Settle per-run token accounting (dsh token-meter equivalent).
 *
 * Provider-reported usage wins; when the endpoint never sends it (common on
 * OpenAI-compatible gateways), fall back to ~4 chars/token measured from the
 * actual wire messages and streamed output. Never throws — usage is telemetry,
 * and a missing payload must not fail a run that already produced its answer.
 */
async function captureUsage(
  run: ChatRunRecord,
  result: { usage?: PromiseLike<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }> },
): Promise<void> {
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const usage = await result.usage;
    inputTokens = usage?.inputTokens ?? 0;
    outputTokens = usage?.outputTokens ?? 0;
  } catch {
    // fall through to the estimate
  }
  if (inputTokens <= 0 && (run.inputChars ?? 0) > 0) {
    inputTokens = Math.round((run.inputChars ?? 0) / 4);
  }
  if (outputTokens <= 0 && (run.outputChars ?? 0) > 0) {
    outputTokens = Math.round((run.outputChars ?? 0) / 4);
  }
  if (inputTokens <= 0 && outputTokens <= 0) return;
  run.usage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function activityFor(run: ChatRunRecord, chunk: UIMessageChunk): string | null {
  switch (chunk.type) {
    case "start":
      return "Thinking…";
    case "start-step":
      return "Working…";
    case "reasoning-start":
    case "reasoning-delta":
      return "Thinking…";
    case "text-start":
    case "text-delta":
      return "Writing…";
    case "tool-input-start":
    case "tool-input-available":
      run.toolNames.set(chunk.toolCallId, chunk.toolName);
      return labelForTool(run, chunk.toolCallId, "Preparing a tool…");
    case "tool-input-delta":
      return labelForTool(run, chunk.toolCallId, "Preparing a tool…");
    case "tool-output-available":
      return `${labelForTool(run, chunk.toolCallId, "Tool")} finished`;
    case "tool-output-error":
      return `${labelForTool(run, chunk.toolCallId, "Tool")} failed`;
    case "finish":
      return "Finishing…";
    case "error":
      return "Something went wrong";
    case "abort":
      return "Stopping…";
    default:
      return null;
  }
}

function labelForTool(
  run: ChatRunRecord,
  toolCallId: string,
  fallback: string,
): string {
  const name = run.toolNames.get(toolCallId);
  if (!name) return fallback;
  const active = TOOL_ACTIVITY[name];
  if (active) return active.replace("…", "");
  return `Running ${name}`;
}


async function finishRun(
  run: ChatRunRecord,
  status: ChatRunStatus,
  error?: string,
) {
  if (isTerminal(run.status)) return;
  if (run.aborted && status === "done") status = "stopped";
  // Every stream must end with an explicit terminal frame so clients never have to infer the outcome.
  if (status === "failed" && !run.chunks.some((c) => c.type === "error")) {
    pushChunk(run, { type: "error", errorText: error || run.error || "Generation failed." });
  } else if (status === "stopped" && !run.chunks.some((c) => c.type === "abort")) {
    pushChunk(run, { type: "abort" } as UIMessageChunk);
  }
  run.status = status;
  run.error =
    status === "failed" ? error || run.error || "Generation failed." : undefined;
  run.activity =
    status === "done" ? "Finished" : status === "stopped" ? "Stopped" : "Failed";
  // Settled runs own no questions: a stopped turn must not leave a question
  // holding a promise, and a finished one has already been answered.
  void cancelRunQuestions(run.id);
  forgetRun(run.id);
  await checkpoint(run, true);
  emit(run);
  // An open goal keeps the session working: another round may follow.
  if (status === "done" && !run.aborted) {
    void driveGoalRound(run);
  }
}

/**
 * Start the next automatic goal round in the same conversation (dsh's
 * goal-round-driver). The new run is an ordinary chat run, so the client's
 * run poll attaches to it, the transcript persists it, and Stop still works.
 *
 * Fire-and-forget: a conflict (the human sent their own message first) or a
 * transient storage error must never fail the turn that just completed.
 */
async function driveGoalRound(run: ChatRunRecord): Promise<void> {
  if (!run.conversationId) return;
  try {
    const { startGoalRound } = await import("@/lib/goals");
    const next = await startGoalRound(run.conversationId);
    if (!next) return;
    const assistant = await materialize(run);
    const messages: UIMessage[] = [
      ...run.history,
      ...(assistant ? [assistant] : []),
      {
        id: `goal-round-${nanoid(10)}`,
        role: "user",
        parts: [{ type: "text", text: next.prompt }],
      },
    ];
    await createChatRun({
      messages,
      settings: run.settings,
      model: run.model,
      permissions: run.permissions,
      excludeTools: run.excludeTools,
      conversationId: run.conversationId,
      workspaceId: run.workspaceId,
      owner: run.ownerId
        ? { uid: run.ownerId, orgId: run.orgId ?? null }
        : undefined,
    });
    appendEvent(
      "goal/round",
      {
        goal_id: next.goal.id,
        round: next.round,
        cap: next.goal.maxGoalRounds,
      },
      { conversationId: run.conversationId, runId: run.id },
    );
  } catch (e: any) {
    console.warn(
      "[goal-round] could not start:",
      run.conversationId,
      e?.message || e,
    );
  }
}

function checkpoint(run: ChatRunRecord, track: boolean): Promise<void> {
  run.lastCheckpoint = Date.now();
  run.writeChain = run.writeChain
    .then(() => persistRun(run))
    .catch((e) => {
      console.error("[chat-run] checkpoint failed:", run.id, e?.message || e);
    });
  return track ? run.writeChain : Promise.resolve();
}

async function persistRun(run: ChatRunRecord) {
  if (!run.conversationId) return;
  const existing = await getConversationMeta(run.conversationId, run.ownerId);
  const assistant = await materialize(run);
  const messages = assistant ? [...run.history, assistant] : [...run.history];
  await saveConversation({
    id: run.conversationId,
    title: existing?.title || deriveTitle(run.history),
    createdAt: existing?.createdAt || run.startedAt,
    updatedAt: Date.now(),
    provider: run.settings.provider,
    model: run.settings.model,
    cwd: run.cwd ?? existing?.cwd,
    messages,
    usage: {
      inputTokens: (existing?.usage?.inputTokens ?? 0) + (run.usage?.inputTokens ?? 0),
      outputTokens: (existing?.usage?.outputTokens ?? 0) + (run.usage?.outputTokens ?? 0),
    },
    lastRun: run.usage
      ? {
          inputTokens: run.usage.inputTokens,
          outputTokens: run.usage.outputTokens,
          decodeMs: run.firstTokenAt ? Math.max(0, Date.now() - run.firstTokenAt) : 0,
          at: Date.now(),
        }
      : existing?.lastRun,
  }, run.ownerId ? { uid: run.ownerId, orgId: run.orgId ?? null } : undefined);
  // Mirror the turn into FalkorDB so Omnia remembers across conversations.
  // Fire-and-forget: memory must never fail a chat.
  void recordOmniaMemory(run.conversationId, messages).catch(() => {});
  // Workspace-bound runs also leave an AgentSession row (goal + status), so
  // the workspace remembers its sessions even when the model never calls a
  // memory tool explicitly.
  void recordWorkspaceSession(run).catch(() => {});
}

/**
 * Upsert the AgentSession for a workspace-bound chat run (idempotent MERGE),
 * then deterministically capture the user's own workspace statements
 * (remembers, TODOs, stated decisions) — no model call required.
 * Runs in persistRun's fire-and-forget chain; failures are swallowed.
 */
async function recordWorkspaceSession(run: ChatRunRecord): Promise<void> {
  if (!run.workspaceId || !run.conversationId) return;
  const { FalkorClient } = await import("@/lib/brain/graph");
  const client = await FalkorClient.get();
  const existing = await getConversationMeta(run.conversationId, run.ownerId);
  const sid = `chatsession:${run.conversationId}`;
  await client.write(
    "MERGE (s:AgentSession {id: $sid}) ON CREATE SET s.started_at = $ts " +
      "SET s.workspace_id = $wid, s.goal = $goal, " +
      "    s.status = $status, s.hidden = false, s.ended_at = $ts " +
      "WITH s MATCH (w:Workspace {id: $wid}) MERGE (s)-[:IN_WORKSPACE]->(w)",
    {
      sid,
      wid: run.workspaceId,
      goal: (existing?.title || "Chat session").slice(0, 200),
      status: run.status === "failed" ? "failed" : "ended",
      ts: new Date().toISOString(),
    },
  );

  const userTexts = (run.requestMessages ?? [])
    .filter((msg) => msg.role === "user")
    .map((msg) => messageText(msg as { parts?: Array<{ type: string; text?: string }> }))
    // Automatic rounds are not human statements; capturing them as workspace
    // facts would poison memory with the continuation prompt.
    .filter((text) => !isGoalRoundPrompt(text));
  const lastUser = userTexts[userTexts.length - 1] ?? "";
  if (lastUser) {
    const { captureWorkspaceFacts } = await import("@/lib/workspace/memory");
    await captureWorkspaceFacts(client, run.workspaceId, lastUser, sid);
  }
}

async function recordOmniaMemory(conversationId: string, messages: UIMessage[]): Promise<void> {
  const userMessages = messages.filter((m) => m.role === "user");
  const lastUser = userMessages[userMessages.length - 1];
  const assistants = messages.filter((m) => m.role === "assistant");
  const lastAssistant = assistants[assistants.length - 1];
  if (lastUser && lastAssistant && messages.indexOf(lastAssistant) > messages.indexOf(lastUser)) {
    const userText = messageText(lastUser);
    // A goal round is machine-authored; remember the work, not the prompt.
    if (isGoalRoundPrompt(userText)) return;
    await recordOmniaTurn(conversationId, "user", userText);
    await recordOmniaTurn(conversationId, "assistant", messageText(lastAssistant));
    // Automatic capture: durable facts land in SemanticMemory whether or not
    // the user said "remember this".
    await captureOmniaMemory(conversationId, userText);
  }
}

function deriveTitle(messages: UIMessage[]): string {
  const firstUser = messages.find(
    (m) =>
      m.role === "user" &&
      !(m as any)?.metadata?.["subchat-context"] &&
      !isGoalRoundPrompt(messageText(m)),
  );
  if (!firstUser) return "New chat";
  const text = (firstUser.parts || [])
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text ?? "")
    .join(" ")
    .trim();
  return text.slice(0, 80) || "New chat";
}

const materialized = new WeakMap<ChatRunRecord, { n: number; message: UIMessage | null }>();

/** The assistant message built from the first `n` chunks (cached while the run has not advanced). */
async function materializeAt(run: ChatRunRecord): Promise<{ message: UIMessage | null; cursor: number }> {
  const n = run.chunks.length;
  const hit = materialized.get(run);
  if (hit && hit.n === n) return { message: hit.message, cursor: n };
  const message = await materializeChunks(run.chunks.slice(0, n));
  materialized.set(run, { n, message });
  return { message, cursor: n };
}

async function materialize(run: ChatRunRecord): Promise<UIMessage | null> {
  return (await materializeAt(run)).message;
}

async function materializeChunks(recorded: UIMessageChunk[]): Promise<UIMessage | null> {
  if (!recorded.length) return null;
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of recorded) controller.enqueue(chunk);
      controller.close();
    },
  });
  let message: UIMessage | null = null;
  for await (const m of readUIMessageStream<UIMessage>({ stream })) {
    message = m;
  }
  return message;
}


export interface ChatRunSnapshot {
  run: ChatRunSummary;
  /** History plus (if any) the in-progress assistant message, as of `cursor`. */
  messages: UIMessage[];
  /** Number of run chunks folded into `messages`; the events stream can resume from exactly here. */
  cursor: number;
  /** The id of the in-progress assistant message (clients replaying from 0 must drop it first). */
  assistantId: string;
}

export async function getChatRunSnapshot(
  id: string,
): Promise<ChatRunSnapshot | null> {
  const run = runs.get(id);
  if (!run) return null;
  const { message: assistant, cursor } = await materializeAt(run);
  return {
    run: summary(run),
    messages: assistant ? [...run.history, assistant] : [...run.history],
    cursor,
    assistantId: run.messageId,
  };
}

/**
 * SSE stream for a run: replays chunks from `cursor`, then follows live until the run is terminal.
 * Frames carry `id: <cursor after this frame>` (see lib/sse.ts) so a dropped connection resumes exactly where
 * it left off. Adjacent deltas are coalesced, writes respect backpressure, and `data-heartbeat` frames let the
 * client detect a stalled connection. Cancelling only unsubscribes: background runs outlive their viewers.
 */
export function chatRunStream(
  id: string,
  opts: { cursor?: number; heartbeatMs?: number } = {},
): ReadableStream<Uint8Array> {
  const run = runs.get(id);
  const encoder = new TextEncoder();
  let cursor = Math.max(0, opts.cursor ?? 0);
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;

  const cleanup = () => {
    closed = true;
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  };
  const write = (text: string): boolean => {
    try {
      ctrl!.enqueue(encoder.encode(text));
      return true;
    } catch {
      cleanup();
      void stopChatRun(id);
      return false;
    }
  };
  const close = () => {
    cleanup();
    try {
      ctrl!.close();
    } catch {
      /* already closed */
    }
  };
  let flushing = false;
  const flush = () => {
    if (closed || !ctrl) return;
    // Reentrancy guard: enqueue() synchronously invokes pull() when the queue
    // has room, and pull() calls flush(). A nested flush would start from the
    // outer call's still-unadvanced cursor and re-write the frame currently
    // being written — doubling every frame on the wire. The client then sees
    // duplicate events (a second reasoning-/text-end for a part the first one
    // already closed) and aborts the message, so nothing renders.
    if (flushing) return;
    flushing = true;
    try {
      if (!run || !runs.has(id)) {
        write(formatFrame("[DONE]"));
        close();
        return;
      }
      while (cursor < run.chunks.length) {
        const frames = coalesceChunks(run.chunks, cursor, run.chunks.length);
        for (const f of frames) {
          if ((ctrl.desiredSize ?? 1) <= 0) return; // slow reader: pull() resumes us
          if (!write(formatFrame(JSON.stringify(f.chunk), f.id))) return;
          cursor = f.id;
        }
      }
      if (isTerminal(run.status)) {
        write(formatFrame("[DONE]"));
        close();
      }
    } finally {
      flushing = false;
    }
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        ctrl = controller;
        write("retry: 1500\n\n");
        if (!run) {
          write(formatFrame("[DONE]"));
          close();
          return;
        }
        unsubscribe = subscribeChatRun(id, flush);
        heartbeat = setInterval(() => {
          if (!closed) write(formatFrame(HEARTBEAT_CHUNK));
        }, opts.heartbeatMs ?? 10_000);
        (heartbeat as unknown as { unref?: () => void }).unref?.();
        flush();
      },
      pull() {
        flush();
      },
      cancel() {
        cleanup();
        void stopChatRun(id);
      },
    },
    { highWaterMark: 256 },
  );
}


const MAX_INLINE_BYTES = 6 * 1024 * 1024;

const MAX_ATTACHMENT_CHARS = 120_000;
const MAX_PDF_PAGES = 200;

function isTextLike(metaMime: string, type?: string): boolean {
  if (/^(text\/|application\/(json|.*\+xml))/i.test(metaMime)) return true;
  if (/xml|csv|markdown|json/i.test(metaMime)) return true;
  return ["text", "code", "markdown", "csv", "mermaid", "table", "html", "svg"].includes(
    type || "",
  );
}

async function extractPdfText(buf: Buffer): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    const pages = Math.min(doc.numPages || 0, MAX_PDF_PAGES);
    const out: string[] = [];
    let chars = 0;
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = (tc.items || [])
        .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
        .join(" ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (text) {
        const header = pages > 1 ? `--- Page ${i} ---\n` : "";
        out.push(header + text);
        chars += header.length + text.length;
        if (chars >= MAX_ATTACHMENT_CHARS) break;
      }
      try {
        (page as any)?.cleanup?.();
      } catch {
      }
    }
    return out.join("\n\n").slice(0, MAX_ATTACHMENT_CHARS);
  } finally {
    try {
      await (doc as any)?.destroy?.();
    } catch {
    }
  }
}

function truncateAttachmentText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_ATTACHMENT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_ATTACHMENT_CHARS), truncated: true };
}

async function inlineLocalAttachments(messages: UIMessage[]): Promise<UIMessage[]> {
  let changed = false;
  const out = await Promise.all(
    messages.map(async (m: any) => {
      if (!m || !Array.isArray(m.parts)) return m;
      let partsChanged = false;
      const parts: any[] = [];
      for (const p of m.parts as any[]) {
        if (p?.type !== "file" || typeof p.url !== "string") {
          parts.push(p);
          continue;
        }
        if (!p.url.startsWith("/")) {
          parts.push(p);
          continue;
        }
        const seg = p.url.split("?")[0].split("/").filter(Boolean);
        const decoded = seg.map((s: string) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        });
        if (decoded[0] !== "api" || decoded[1] !== "files" || decoded.length < 4) {
          partsChanged = true;
          parts.push({
            type: "text",
            text: `[Attachment "${p.filename || p.url}" could not be loaded and was skipped.]`,
          });
          continue;
        }
        const meta = getArtifact(decoded[2]);
        const requestedName = decoded.slice(3).join("/");
        if (!meta || requestedName !== meta.filename) {
          partsChanged = true;
          parts.push({
            type: "text",
            text: `[Attachment "${p.filename || p.url}" could not be loaded and was skipped.]`,
          });
          continue;
        }
        const buf = readArtifactBuffer(meta);
        if (!buf) {
          partsChanged = true;
          parts.push({
            type: "text",
            text: `[Attachment "${p.filename || meta.filename}" could not be loaded and was skipped.]`,
          });
          continue;
        }
        const displayName = p.filename || meta.filename;
        const mime = p.mediaType || meta.mime || "application/octet-stream";
        partsChanged = true;

        const isPdf =
          meta.type === "pdf" || /\/pdf\b/i.test(mime) || /\.pdf$/i.test(meta.filename);
        if (isPdf) {
          try {
            const extracted = (await extractPdfText(buf)).trim();
            if (extracted.length > 20) {
              const { text, truncated } = truncateAttachmentText(extracted);
              parts.push({
                type: "text",
                text:
                  `[Attached PDF "${displayName}" — text extracted for you to read:\n\n${text}]` +
                  (truncated ? "\n[Note: document truncated to fit context.]" : ""),
              });
              continue;
            }
          } catch (e) {
            console.error("[chat] pdf text extract failed:", (e as any)?.message || e);
          }
        }

        if (!isPdf && isTextLike(mime, meta.type)) {
          try {
            const raw = buf.toString("utf8");
            if (raw.trim()) {
              const { text, truncated } = truncateAttachmentText(raw);
              parts.push({
                type: "text",
                text:
                  `[Attached file "${displayName}":\n\n${text}]` +
                  (truncated ? "\n[Note: file truncated to fit context.]" : ""),
              });
              continue;
            }
          } catch {
          }
        }

        if (buf.byteLength > MAX_INLINE_BYTES) {
          parts.push({
            type: "text",
            text: `[Attachment "${displayName}" is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB — too large to send to the model.]`,
          });
          continue;
        }
        parts.push({ ...p, filename: displayName, url: `data:${mime};base64,${buf.toString("base64")}` });
      }
      if (partsChanged) changed = true;
      return partsChanged ? { ...m, parts } : m;
    }),
  );
  return (changed ? out : messages) as UIMessage[];
}

function describeStreamError(error: unknown): string {
  try {
    console.error("[chat] stream error:", {
      name: (error as any)?.name,
      message: (error as any)?.message,
      status: (error as any)?.statusCode,
      body: String((error as any)?.responseBody ?? "").slice(0, 500),
    });
  } catch {
  }
  if (error instanceof APICallError) {
    const status =
      typeof error.statusCode === "number" ? ` (HTTP ${error.statusCode})` : "";
    let detail: unknown;
    try {
      const body = error.responseBody;
      if (typeof body === "string" && body.trim().startsWith("{")) {
        const parsed = JSON.parse(body);
        detail = (parsed as any)?.error?.message ?? (parsed as any)?.message;
      } else {
        detail =
          (body as any)?.error?.message ??
          (body as any)?.message ??
          (typeof body === "string" ? body : undefined);
      }
    } catch {
    }
    const text =
      typeof detail === "string" && detail.trim()
        ? detail.trim().slice(0, 300)
        : error.message && error.message !== "An error occurred."
          ? error.message
          : undefined;
    const base = `The provider returned an error${status}.${text ? ` ${text}` : ""}`;
    if (
      error.statusCode === 404 &&
      /model|not.?found|no longer available|does not exist/i.test(`${text} ${error.message}`)
    ) {
      return `${base} The model id may be retired — pick a current model from the model picker (it refreshes live from the provider), or rename/add the id under API keys → Models.`;
    }
    return base;
  }
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 300);
  }
  return "An error occurred.";
}
