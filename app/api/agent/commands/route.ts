import { NextResponse } from "next/server";
import { authed } from "@/lib/auth/context";
import { findCommand, listCommands } from "@/lib/agent/commands";
import { DEFAULT_PERMISSIONS } from "@/lib/agent/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Run a slash command.
 *
 * A command answers itself: it never becomes a model message. The reply comes
 * back as JSON, and the client shows it and applies whatever the command
 * changed.
 */
export const POST = authed(async (request, user) => {
  let body: {
    command?: string;
    argument?: string;
    conversationId?: string;
    permissions?: { mode?: string; policy?: string };
    preset?: string | null;
    hasWorkspace?: boolean;
    settings?: Record<string, unknown>;
    workspaceId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const name = (body.command ?? "").trim().toLowerCase();
  const command = findCommand(name);
  if (!command) {
    const known = listCommands().map((c) => `/${c.name}`).join(", ");
    return NextResponse.json(
      { error: `There is no command called "/${name}". The commands are: ${known}.` },
      { status: 404 },
    );
  }

  try {
    const outcome = await command.run({
      conversationId: body.conversationId,
      argument: body.argument ?? "",
      permissions: {
        mode: (body.permissions?.mode as never) ?? DEFAULT_PERMISSIONS.mode,
        policy: (body.permissions?.policy as never) ?? DEFAULT_PERMISSIONS.policy,
      },
      preset: body.preset ?? null,
      hasWorkspace: Boolean(body.hasWorkspace),
      userId: user.uid,
      settings: body.settings,
      workspaceId: body.workspaceId,
    });
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "The command failed." },
      { status: 400 },
    );
  }
});

/** The commands this app answers itself. */
export const GET = authed(async () => {
  return NextResponse.json({
    commands: listCommands().map((command) => ({
      name: command.name,
      description: command.description,
    })),
  });
});

