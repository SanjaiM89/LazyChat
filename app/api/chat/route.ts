import { after } from "next/server";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { authed } from "@/lib/auth/context";
import {
  ChatRunConflictError,
  chatRunDone,
  chatRunStream,
  createChatRun,
  prepareChatRun,
} from "@/lib/chat-runs";
import { commandNameOf } from "@/lib/agent/commands";
import { DEFAULT_PERMISSIONS } from "@/lib/agent/permissions";

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

  // A slash command is answered by the app itself, never by the model.
  if (typeof body.conversationId === "string") {
    const msgs = body.messages || [];
    const lastUser = [...(msgs as any[]).reverse()].find((m: any) => m?.role === "user");
    if (lastUser) {
      const textParts = (lastUser.parts || []).filter((p: any) => p.type === "text").map((p: any) => p.text ?? "");
      const whole = textParts.join("\n");
      const firstLine = whole.split("\n")[0]?.trim() ?? "";
      const name = commandNameOf(firstLine);
      if (name) {
        const { findCommand } = await import("@/lib/agent/commands");
        const command = findCommand(name);
        if (command) {
          const outcome = await command.run({
            conversationId: body.conversationId,
            argument: firstLine.slice(name.length + 1).trim(),
            permissions: body.permissions ?? DEFAULT_PERMISSIONS,
            preset: body.permissionPreset ?? null,
            hasWorkspace: typeof body.workspaceId === "string",
            userId: user.uid,
            settings: body.settings,
            workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
          });
          if (outcome.runId) {
            after(chatRunDone(outcome.runId));
            return new Response(chatRunStream(outcome.runId), {
              headers: { ...UI_MESSAGE_STREAM_HEADERS, "x-chat-run-id": outcome.runId },
            });
          }
          return new Response(JSON.stringify(outcome), {
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (firstLine === "/plan" || firstLine === "/plan off") {
        const { enterPlanMode, exitPlanMode } = await import("@/lib/plan-mode");
        if (firstLine === "/plan") await enterPlanMode(body.conversationId);
        else await exitPlanMode(body.conversationId);
        // Strip the command line from the message.
        const rest = whole.slice(firstLine.length).trim();
        lastUser.parts = rest ? [{ type: "text", text: rest }] : [];
        if (!lastUser.parts.length) {
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
      permissions: body.permissions,
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
