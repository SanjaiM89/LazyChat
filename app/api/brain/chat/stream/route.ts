/**
 * Stream a chat turn as Server-Sent Events: trace events first, then the answer.
 *
 * Request (POST JSON): {"message": str, "session_id": str?, "user_id": str?}
 *
 * Events (each a `data:` frame tagged with "type"):
 *   start            {"type":"start", "session_id":str}
 *   tool             {"type":"tool", "tool":str, "arguments":{}, "cypher":str,
 *                     "result_summary":str, "duration_ms":float, "row_count":int}
 *   memory           {"type":"memory", "memories":[...]}
 *   handoff          {"type":"handoff", "from":str, "to":str, "findings":int}
 *   procedures       {"type":"procedures", "procedures":[...]}
 *   delta            {"type":"delta", "text":str}   <- answer word by word
 *   procedure_learned {"type":"procedure_learned", "procedure":{...}}
 *   done             {"type":"done", ...full answer payload...}
 *   error            {"type":"error", "message":str}
 */
import { askAgent, knownServices, knownTopics } from "@/lib/brain/agent";
import { ensureReady } from "@/lib/brain/bootstrap";
import { RESEARCHER, SYNTHESIZER } from "@/lib/brain/crew";import { FalkorClient, GraphError } from "@/lib/brain/graph";
import { getLlm } from "@/lib/brain/llm";
import { consolidateSession } from "@/lib/brain/memory/consolidation";
import { ensureSession, recallMemories } from "@/lib/brain/memory/session";
import type { ChatResponse, TraceStep } from "@/lib/brain/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StreamBody = {
  message?: string;
  session_id?: string | null;
  user_id?: string;
};

const encoder = new TextEncoder();

function frame(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Split the answer so the UI can render tokens as they land. */
function chunksForStream(text: string, size = 6): string[] {
  const words = text.split(" ");
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) {
    out.push(words.slice(i, i + size).join(" ") + (i + size < words.length ? " " : ""));
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  await ensureReady();
  let body: StreamBody;
  try {
    body = (await request.json()) as StreamBody;
  } catch {
    return sseError("request body must be JSON");
  }
  const message = (body.message ?? "").trim();
  if (!message) return sseError("message is required");
  const userId = body.user_id || "demo";
  const requestedSession = body.session_id ?? null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(frame(payload));
        } catch {
          // A closed stream must not abort the agent loop.
        }
      };

      let client: FalkorClient;
      try {
        client = await FalkorClient.get();
      } catch (err) {
        send({ type: "error", message: `graph unavailable: ${(err as Error).message}` });
        controller.close();
        return;
      }

      try {
        const sessionId = await ensureSession(client, userId, requestedSession);
        send({ type: "start", session_id: sessionId });

        // Recalling happens before research so the UI can show what the user
        // already established in an earlier session.
        let memories: Awaited<ReturnType<typeof recallMemories>> = [];
        try {
          memories = await recallMemories(client, userId, message);
        } catch {
          // recall must never block an answer
        }
        if (memories.length > 0) send({ type: "memory", memories });

        // Run the agent while draining tool steps as they complete.
        const steps: TraceStep[] = [];
        let settled = false;
        let failure: unknown = null;
        let result: ChatResponse | null = null;
        const run = askAgent(message, {
          sessionId,
          userId,
          client,
          onStep: (step) => {
            steps.push(step);
          },
        }).then(
          (r) => {
            result = r;
            settled = true;
          },
          (e: unknown) => {
            failure = e;
            settled = true;
          },
        );

        let cursor = 0;
        const drain = () => {
          while (cursor < steps.length) {
            const s = steps[cursor];
            cursor += 1;
            send({
              type: "tool",
              tool: s.tool,
              arguments: s.arguments,
              cypher: s.cypher,
              result_summary: s.result_summary,
              row_count: s.row_count,
              duration_ms: s.duration_ms,
              error: s.error,
            });
          }
        };

        while (!settled) {
          drain();
          await sleep(60);
        }
        await run;
        drain();

        if (failure || !result) {
          throw failure instanceof Error ? failure : new Error("agent failed");
        }
        const done = result as ChatResponse;

        if (done.agents_involved.includes(RESEARCHER) && done.agents_involved.includes(SYNTHESIZER)) {
          send({ type: "handoff", from: RESEARCHER, to: SYNTHESIZER, findings: done.reasoning_trace.length });
        }
        if (done.procedures_used.length > 0) {
          send({ type: "procedures", procedures: done.procedures_used });
        }

        for (const chunk of chunksForStream(done.answer)) {
          send({ type: "delta", text: chunk });
        }

        if (done.procedure_learned) {
          send({ type: "procedure_learned", procedure: done.procedure_learned });
        }

        try {
          const llm = getLlm({
            knownServices: await knownServices(client),
            knownTopics: await knownTopics(client),
          });
          await consolidateSession(client, done.session_id, userId, { llm });
        } catch (err) {
          console.warn(`[brain] consolidation failed: ${(err as Error).message}`);
        }

        send({
          type: "done",
          answer: done.answer,
          reasoning_trace: done.reasoning_trace,
          graph_context: done.graph_context,
          sources: done.sources,
          agents_involved: done.agents_involved,
          session_id: done.session_id,
          activity: done.activity,
          procedures_used: done.procedures_used,
          procedure_learned: done.procedure_learned,
        });
      } catch (err) {
        if (err instanceof GraphError) {
          send({ type: "error", message: `graph unavailable: ${err.message}` });
        } else {
          console.error(`[brain] chat stream failed: ${(err as Error).stack ?? err}`);
          send({ type: "error", message: (err as Error).message ?? "internal server error" });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** A stream that carries a single error (for requests that fail upfront). */
function sseError(message: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(frame({ type: "error", message }));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
