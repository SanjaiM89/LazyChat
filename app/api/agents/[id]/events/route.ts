import { NextRequest } from "next/server";
import { getAgent, subscribeAgent } from "@/lib/agents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
        }
      };

      send({ type: "snapshot", agent });
      const unsub = subscribeAgent(id, (a) => send({ type: "patch", agent: a }));

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepAlive);
        }
      }, 15_000);

      const current = getAgent(id);
      if (current && ["done", "failed", "stopped"].includes(current.status)) {
        setTimeout(() => {
          clearInterval(keepAlive);
          try {
            controller.close();
          } catch {
          }
          unsub();
        }, 2500);
        return;
      }

      const poll = setInterval(() => {
        const a = getAgent(id);
        if (a && ["done", "failed", "stopped"].includes(a.status)) {
          clearInterval(poll);
          clearInterval(keepAlive);
          send({ type: "patch", agent: a });
          setTimeout(() => {
            try {
              controller.close();
            } catch {
            }
            unsub();
          }, 500);
        }
      }, 2000);
      return () => {
        clearInterval(poll);
        clearInterval(keepAlive);
        unsub();
      };
    },
    cancel() {
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
