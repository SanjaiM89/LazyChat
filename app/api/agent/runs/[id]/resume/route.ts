import { authed } from "@/lib/auth/context";
import { resumeRun } from "@/lib/agent/recovery";
import { DEFAULT_PERMISSIONS, type PermissionSettings } from "@/lib/agent/permissions";
import { DEFAULT_SETTINGS, type ChatSettings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Carry on with a run that was interrupted. */
export const POST = authed(async (req, _user, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is fine: the defaults apply.
  }

  const result = await resumeRun(id, {
    settings: { ...DEFAULT_SETTINGS, ...(body.settings ?? {}) } as ChatSettings,
    permissions: { ...DEFAULT_PERMISSIONS, ...(body.permissions ?? {}) } as PermissionSettings,
    workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
});
