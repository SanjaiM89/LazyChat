import { after } from "next/server";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { authed } from "@/lib/auth/context";
import {
  ChatRunConflictError,
  chatRunStream,
  createChatRun,
  prepareChatRun,
} from "@/lib/chat-runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3600;

export const POST = authed(async (req: Request, user) => {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid request body.");
  }

  // Intercept /plan command — enter plan mode before the run starts.
  if (typeof body.conversationId === "string") {
    const msgs = body.messages || [];
    const lastUser = [...(msgs as any[]).reverse()].find((m: any) => m?.role === "user");
    if (lastUser) {
      const textParts = (lastUser.parts || []).filter((p: any) => p.type === "text").map((p: any) => p.text ?? "");
      const firstLine = textParts.join("\n").split("\n")[0]?.trim() ?? "";
      if (firstLine === "/plan" || firstLine === "/plan off") {
        const { enterPlanMode, exitPlanMode } = await import("@/lib/plan-mode");
        if (firstLine === "/plan") await enterPlanMode(body.conversationId);
        else await exitPlanMode(body.conversationId);
        // Strip the command line from the message.
        const rest = textParts.join("\n").slice(firstLine.length).trim();
        lastUser.parts = rest ? [{ type: "text", text: rest }] : [];
        if (!lastUser.parts.length) {
          // Nothing left after the command: keep the turn meaningful.
          lastUser.parts = [
            {
              type: "text",
              text:
                firstLine === "/plan"
                  ? "Please draft a plan for the work ahead."
                  : "Plan mode is off. Acknowledge briefly and wait for my instructions.",
            },
          ];
        }
      }
    }
  }

  try {
    const { settings, model } = await prepareChatRun(body.settings);

    const run = await createChatRun({
      messages: body.messages || [],
      settings,
      model,
      conversationId:
        typeof body.conversationId === "string" ? body.conversationId : undefined,
      trigger: body.trigger,
      workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
      owner: { uid: user.uid, orgId: user.orgId },
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
});

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
