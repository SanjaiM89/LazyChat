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
import { enabledTools } from "@/lib/tools";
import { buildMCPToolSet } from "@/lib/mcp";
import { buildSystemPrompt } from "@/lib/system";
import { getArtifact, readArtifactBuffer } from "@/lib/artifacts";
import { getConversation, saveConversation } from "@/lib/store";

/* ------------------------------------------------------------------ */
/*  Chat run orchestrator                                              */
/*                                                                     */
/*  A "run" is one assistant reply that lives on the SERVER, not in    */
/*  the HTTP response that started it. Closing the tab therefore does   */
/*  not stop generation: the run keeps consuming the model stream,      */
/*  checkpoints the conversation to disk, and any client that shows up  */
/*  later attaches over SSE (full replay + live tail) to watch it.      */
/*                                                                     */
/*  Same shape as lib/agents.ts: in-memory registry + listeners + SSE.  */
/* ------------------------------------------------------------------ */

export interface ChatRunRecord {
  id: string;
  conversationId?: string;
  status: ChatRunStatus;
  /** human readable "what is it doing right now" */
  activity: string;
  /** completed model steps */
  step: number;
  /** assistant message id this run writes into (matches the client's) */
  messageId: string;
  /** messages exactly as the client sent them (used for the model call) */
  requestMessages: UIMessage[];
  /** snapshot/persistence base — drops the assistant message on regenerate */
  history: UIMessage[];
  settings: ChatSettings;
  /** pre-built language model (so config errors surface before the run starts) */
  model?: LanguageModel;
  /** every UIMessageChunk emitted so far — replayable by late subscribers */
  chunks: UIMessageChunk[];
  /** toolCallId → tool name, for "what is it doing" labels */
  toolNames: Map<string, string>;
  listeners: Set<() => void>;
  abort: AbortController;
  /** resolves when the run reaches a terminal status */
  done: Promise<void>;
  startedAt: number;
  updatedAt: number;
  error?: string;
  /** true when the provider stream was aborted by the user */
  aborted?: boolean;
  lastCheckpoint: number;
  /** serializes checkpoints so overlapping writes can't clobber each other */
  writeChain: Promise<void>;
  /** false when the chunk log can no longer be replayed from 0 */
  replayable: boolean;
}

const runs = new Map<string, ChatRunRecord>();

/** How long a finished run stays queryable (so a returning client can see it). */
const KEEP_FINISHED_MS = 10 * 60 * 1000;

/** Checkpoints are throttled; the final write always happens. */
const CHECKPOINT_MS = 4000;

const TOOL_ACTIVITY: Record<string, string> = {
  webSearch: "Searching the web…",
  createArtifact: "Creating an artifact…",
  runAgentTask: "Running a sandbox agent…",
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
      /* ignore */
    }
  }
}

export function getChatRun(id: string): ChatRunSummary | null {
  const r = runs.get(id);
  return r ? summary(r) : null;
}

export function listChatRuns(conversationId?: string): ChatRunSummary[] {
  return [...runs.values()]
    .filter((r) => !conversationId || r.conversationId === conversationId)
    .map(summary)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Currently running (not yet finished) runs, newest first. */
export function activeChatRuns(conversationId?: string): ChatRunSummary[] {
  return listChatRuns(conversationId).filter((r) => r.status === "running");
}

export function subscribeChatRun(id: string, fn: () => void): () => void {
  const r = runs.get(id);
  if (!r) return () => {};
  r.listeners.add(fn);
  return () => r.listeners.delete(fn);
}

/** Drop finished runs once they're old — they stay queryable for a while so a
 *  client that comes back right after the end still sees what happened. */
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

/* --------------------------- create + run --------------------------- */

export interface CreateChatRunInput {
  messages: UIMessage[];
  settings?: Partial<ChatSettings>;
  /** built by prepareChatRun() — keeps provider errors out of the background */
  model?: LanguageModel;
  conversationId?: string;
  trigger?: "submit-message" | "regenerate-message";
}

/**
 * Merge settings and build the language model *before* a run exists.
 *
 * Without this, an unconfigured provider (missing API key, unknown custom
 * provider) would fail inside the detached run and the user would just see the
 * reply never arrive. Building it here lets the route answer with the error, so
 * the chat shows it exactly like it did before runs became background work.
 */
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

/** Thrown when the conversation already has a live run (multi-tab / races). */
export class ChatRunConflictError extends Error {
  readonly activeRunId: string;
  constructor(activeRunId: string) {
    super("This conversation is already generating a reply.");
    this.activeRunId = activeRunId;
  }
}

/**
 * Register a run and start generating immediately — the caller only has to
 * return a 202, so the reply is not tied to that response's lifetime.
 */
export function createChatRun(input: CreateChatRunInput): ChatRunRecord {
  const settings: ChatSettings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
  const requestMessages = input.messages || [];
  if (!requestMessages.length) throw new Error("No messages.");

  const conversationId = input.conversationId;
  if (conversationId) {
    const live = activeChatRuns(conversationId)[0];
    if (live) throw new ChatRunConflictError(live.id);
  }

  // Mirror the AI SDK's id resolution (getResponseUIMessageId): regenerating
  // reuses the assistant message being replaced, a new turn gets a fresh id.
  const last = requestMessages[requestMessages.length - 1];
  const isContinuation = last?.role === "assistant";
  const messageId = isContinuation ? last.id : nanoid(12);

  const run: ChatRunRecord = {
    id: nanoid(10),
    conversationId,
    status: "running",
    activity: "Starting…",
    step: 0,
    messageId,
    requestMessages,
    history: isContinuation ? requestMessages.slice(0, -1) : requestMessages,
    settings,
    model: input.model,
    chunks: [],
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

  // Persist the transcript (user message included) before generation starts, so
  // the conversation exists in the sidebar even if the process dies mid-reply.
  void checkpoint(run, true);

  run.done = pump(run);
  return run;
}

/** Abort a live run. Returns false when the run doesn't exist. */
export async function stopChatRun(id: string): Promise<boolean> {
  const run = runs.get(id);
  if (!run) return false;
  if (isTerminal(run.status)) return true;
  run.aborted = true;
  run.activity = "Stopping…";
  emit(run);
  try {
    run.abort.abort();
  } catch {
    /* ignore */
  }
  // Safety net: if the provider ignores the abort signal, finalize anyway so
  // the UI never sticks on a phantom "generating" state.
  const watchdog = setTimeout(() => {
    if (run.status === "running") void finishRun(run, "stopped", undefined);
  }, 5000);
  (watchdog as any).unref?.();
  return true;
}


/* ------------------------------- pump ------------------------------- */

/** Consume the model stream server-side — no client required. */
async function pump(run: ChatRunRecord) {
  const { settings } = run;
  try {
    const model =
      run.model ??
      (await buildLanguageModel({
        provider: settings.provider,
        model: settings.model,
      }));

    const tools = {
      ...enabledTools(settings.tools, {
        provider: settings.provider,
        model: settings.model,
        conversationId: run.conversationId,
      }),
      ...(await buildMCPToolSet()),
    };

    const system = await buildSystemPrompt({
      provider: settings.provider,
      model: settings.model,
    });

    const useThinking = settings.thinking;
    const providerOptions = thinkingProviderOptions(
      settings.provider,
      settings.model,
      useThinking,
    );
    // Some reasoning configurations disallow custom temperature (Anthropic
    // requires temperature=1 when thinking is enabled — including Claude
    // models served through OpenCode Zen's Messages endpoint).
    const anthropicThinking =
      settings.provider === "anthropic" ||
      (settings.provider === "opencode" &&
        getOpencodeTransport(settings.model) === "anthropic");
    const temperature =
      useThinking && anthropicThinking
        ? undefined
        : settings.temperature;

    const result = streamText({
      model,
      system,
      messages: await convertToModelMessages(
        await inlineLocalAttachments(run.requestMessages),
      ),
      tools,
      stopWhen: isStepCount(settings.maxSteps ?? 14),
      temperature,
      providerOptions: providerOptions as any,
      abortSignal: run.abort.signal,
    });

    const stream = toUIMessageStream({
      stream: result.stream,
      tools,
      sendReasoning: true,
      sendSources: true,
      sendStart: true,
      // `originalMessages` + a stable message id: the client replaces the right
      // bubble on regenerate, and a client that attaches mid-run gets a snapshot
      // whose partial assistant message carries the same id as the replay.
      originalMessages: run.requestMessages,
      generateMessageId: () => run.messageId,
      onError: describeStreamError,
    });

    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) pushChunk(run, value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }

    const status: ChatRunStatus = run.aborted
      ? "stopped"
      : run.error
        ? "failed"
        : "done";
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

function pushChunk(run: ChatRunRecord, chunk: UIMessageChunk) {
  if (chunk.type === "abort") run.aborted = true;
  if (chunk.type === "start-step") run.step += 1;
  if (chunk.type === "error") run.error = chunk.errorText;

  run.chunks.push(chunk);
  const next = activityFor(run, chunk);
  if (next) run.activity = next;

  // Keep the on-disk transcript close to the live one without writing on every
  // token.
  if (Date.now() - run.lastCheckpoint > CHECKPOINT_MS) void checkpoint(run, true);

  emit(run);
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


/* --------------------------- finish + persist --------------------------- */

async function finishRun(
  run: ChatRunRecord,
  status: ChatRunStatus,
  error?: string,
) {
  if (isTerminal(run.status)) return;
  if (run.aborted && status === "done") status = "stopped";
  run.status = status;
  run.error =
    status === "failed" ? error || run.error || "Generation failed." : undefined;
  run.activity =
    status === "done" ? "Finished" : status === "stopped" ? "Stopped" : "Failed";
  // Final flush so subscribers close their streams with the complete reply.
  await checkpoint(run, true);
  emit(run);
}

/**
 * Queue a transcript write. Writes are chained per run so a slow checkpoint can
 * never land after (and clobber) the final one.
 */
function checkpoint(run: ChatRunRecord, track: boolean): Promise<void> {
  run.lastCheckpoint = Date.now();
  run.writeChain = run.writeChain
    .then(() => persistRun(run))
    .catch((e) => {
      console.error("[chat-run] checkpoint failed:", run.id, e?.message || e);
    });
  return track ? run.writeChain : Promise.resolve();
}

/** Write the run's transcript to data/conversations.json. */
async function persistRun(run: ChatRunRecord) {
  if (!run.conversationId) return;
  const existing = await getConversation(run.conversationId);
  const assistant = await materialize(run);
  const messages = assistant ? [...run.history, assistant] : [...run.history];
  await saveConversation({
    id: run.conversationId,
    title: existing?.title || deriveTitle(run.history),
    createdAt: existing?.createdAt || run.startedAt,
    updatedAt: Date.now(),
    provider: run.settings.provider,
    model: run.settings.model,
    messages,
  });
}

/** First user text, capped — the same rule the client used to apply. */
function deriveTitle(messages: UIMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New chat";
  const text = (firstUser.parts || [])
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text ?? "")
    .join(" ")
    .trim();
  return text.slice(0, 80) || "New chat";
}

/** Rebuild the streaming assistant message from the recorded chunks. */
async function materialize(run: ChatRunRecord): Promise<UIMessage | null> {
  if (!run.chunks.length) return null;
  const recorded = run.chunks.slice();
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

/* ------------------------- attach (SSE replay) ------------------------- */

export interface ChatRunSnapshot {
  run: ChatRunSummary;
  /** transcript + the partial assistant message the run is writing */
  messages: UIMessage[];
}

/** Everything a client needs to render a run it was not streaming. */
export async function getChatRunSnapshot(
  id: string,
): Promise<ChatRunSnapshot | null> {
  const run = runs.get(id);
  if (!run) return null;
  const assistant = await materialize(run);
  return {
    run: summary(run),
    messages: assistant ? [...run.history, assistant] : [...run.history],
  };
}

/**
 * SSE view of a run: replays every recorded chunk (so a fresh client can build
 * the whole message) and then follows it live. Framing matches what
 * DefaultChatTransport/resumeStream parse: `data: <UIMessageChunk>` frames,
 * `: keepalive` comments, terminated by `data: [DONE]`.
 */
export function chatRunStream(
  id: string,
  opts: { cursor?: number; keepAliveMs?: number } = {},
): ReadableStream<Uint8Array> {
  const run = runs.get(id);
  const encoder = new TextEncoder();
  let cursor = Math.max(0, opts.cursor ?? 0);
  let unsubscribe: () => void = () => {};
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        unsubscribe();
        if (keepAlive) clearInterval(keepAlive);
        keepAlive = undefined;
      };
      const write = (text: string): boolean => {
        try {
          controller.enqueue(encoder.encode(text));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };
      const flush = () => {
        if (!runs.has(id)) {
          write("data: [DONE]\n\n");
          close();
          return;
        }
        while (cursor < run!.chunks.length) {
          if (!write(`data: ${JSON.stringify(run!.chunks[cursor++])}\n\n`)) return;
        }
        if (isTerminal(run!.status)) {
          write("data: [DONE]\n\n");
          close();
        }
      };
      const close = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      if (!run) {
        write("data: [DONE]\n\n");
        close();
        return;
      }

      unsubscribe = subscribeChatRun(id, flush);
      keepAlive = setInterval(() => {
        write(": keepalive\n\n");
      }, opts.keepAliveMs ?? 15_000);
      (keepAlive as any).unref?.();
      flush();
    },
    cancel() {
      unsubscribe();
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = undefined;
    },
  });
}


/* --------------------------- model plumbing --------------------------- */

/** Attachments larger than this are summarized, not inlined. */
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

/** Max extracted text sent to the model per attachment (~30k tokens). */
const MAX_ATTACHMENT_CHARS = 120_000;
/** Don't spend forever parsing gigantic PDFs server-side. */
const MAX_PDF_PAGES = 200;

/** MIME types that are cheaper + more reliable as text than as data URLs. */
function isTextLike(metaMime: string, type?: string): boolean {
  if (/^(text\/|application\/(json|.*\+xml))/i.test(metaMime)) return true;
  if (/xml|csv|markdown|json/i.test(metaMime)) return true;
  return ["text", "code", "markdown", "csv", "mermaid", "table", "html", "svg"].includes(
    type || "",
  );
}

/**
 * Pull readable text out of a PDF buffer with pdfjs-dist (already a
 * dependency for the client-side viewer). Binary PDFs are the reason uploads
 * currently fail: a 4 MB PDF becomes a ~5.5 MB base64 data URL, which most
 * providers reject outright. Extracted text always reaches the model.
 */
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
        /* ignore */
      }
    }
    return out.join("\n\n").slice(0, MAX_ATTACHMENT_CHARS);
  } finally {
    try {
      await (doc as any)?.destroy?.();
    } catch {
      /* ignore */
    }
  }
}

function truncateAttachmentText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_ATTACHMENT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_ATTACHMENT_CHARS), truncated: true };
}

/**
 * Rewrite local attachment URLs (/api/files/…) so the model can read them.
 *
 * The AI SDK's convertToModelMessages does `new URL(part.url)` with no base,
 * so a relative attachment URL throws "Invalid URL" and kills the whole chat
 * request. Inlining from disk also fixes the deeper problem: providers can't
 * fetch localhost URLs anyway, so without this attachments never reach the
 * model at all.
 *
 * PDFs and text-like files are sent as extracted TEXT (not base64 data URLs):
 * a multi-MB PDF as a data URL is rejected by most providers, while text
 * always works regardless of the provider's file support.
 */
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
        // /api/files/<artifactId>/<filename> (filename may be URL-encoded)
        const decoded = seg.map((s: string) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        });
        if (decoded[0] !== "api" || decoded[1] !== "files" || decoded.length < 4) {
          // Not a resolvable local file — a relative URL would crash
          // convertToModelMessages ("Invalid URL") and take down the whole
          // request, so degrade to a note instead.
          partsChanged = true;
          parts.push({
            type: "text",
            text: `[Attachment "${p.filename || p.url}" could not be loaded and was skipped.]`,
          });
          continue;
        }
        const meta = getArtifact(decoded[2]);
        const requestedName = decoded.slice(3).join("/");
        // Accept legacy exact matches plus encoded variants, so uploads from
        // before the filename fix (random `<id>.pdf` names) still resolve.
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

        // --- PDFs: extract text, never send multi-MB base64 to the provider.
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
          // Scanned/image-only PDF or extraction failed → fall back to the
          // binary below (if small enough) so vision-capable models can try.
        }

        // --- Text-like files: send content as text, not data URLs.
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
            /* fall through to data URL */
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

/** Build a short, human-readable message from a streamed model error. */
function describeStreamError(error: unknown): string {
  // Always keep the full upstream error server-side (the terminal running
  // `next dev`) — the client only gets the short summary below.
  try {
    console.error("[chat] stream error:", {
      name: (error as any)?.name,
      message: (error as any)?.message,
      status: (error as any)?.statusCode,
      body: String((error as any)?.responseBody ?? "").slice(0, 500),
    });
  } catch {
    /* logging must never break the stream */
  }
  // Provider/transport errors carry an HTTP status + response body.
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
      /* fall through */
    }
    const text =
      typeof detail === "string" && detail.trim()
        ? detail.trim().slice(0, 300)
        : error.message && error.message !== "An error occurred."
          ? error.message
          : undefined;
    const base = `The provider returned an error${status}.${text ? ` ${text}` : ""}`;
    // Retired / unknown model ids come back as 404s — point at the fix
    // instead of leaving the user with a raw upstream message.
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

