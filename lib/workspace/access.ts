import { getWorkspace } from "./workspaces";
import type { Workspace } from "./types";
import type { FalkorClient } from "@/lib/brain/graph";
import type { AuthUser } from "@/lib/auth/shared";

/**
 * Workspace access.
 *
 * A workspace is a folder on this machine, the way the harness treats one, so
 * there is no confined area to live in. What is still enforced is ownership:
 * a workspace belongs to the user who registered it, and the file tools stay
 * confined to the session's own working directory.
 */

/** The workspace if it exists and belongs to this user; otherwise null (callers answer 404). */
export async function ownedWorkspace(client: FalkorClient, id: string, user: AuthUser): Promise<Workspace | null> {
  const ws = await getWorkspace(client, id);
  return ws && ws.owner === user.uid ? ws : null;
}
