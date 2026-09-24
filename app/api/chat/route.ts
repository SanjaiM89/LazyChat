import { after } from "next/server";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import {
  ChatRunConflictError,
  chatRunStream,
  createChatRun,
  prepareChatRun,
} from "@/lib/chat-runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3600;

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid request body.");
  }

  try {
    const { settings, model } = await prepareChatRun(body.settings);

    const run = createChatRun({
      messages: body.messages || [],
      settings,
      model,
      conversationId:
        typeof body.conversationId === "string" ? body.conversationId : undefined,
      trigger: body.trigger,
    });

    after(run.done);

    return new Response(chatRunStream(run.id), {
      headers: { ...UI_MESSAGE_STREAM_HEADERS, "x-chat-run-id": run.id },
    });
  } catch (e: any) {
    if (e instanceof ChatRunConflictError) {
      return jsonError(e.message, 409);
    }
    return jsonError(
      e?.message || "Something went wrong while talking to the model.",
      400,
    );
  }
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
