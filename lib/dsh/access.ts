import fs from "node:fs";
import path from "node:path";
import type { FalkorClient } from "@/lib/brain/graph";
import type { AuthUser } from "@/lib/auth/shared";
import { getWorkspace } from "./workspaces";
import type { Workspace } from "./types";

/** Each user's workspaces live under their own directory; nothing else on the host is reachable. */
export function workspaceRoot(uid: string): string {
  const dir = path.join(process.cwd(), "data", "users", uid.replace(/[^A-Za-z0-9_-]/g, "_"), "workspaces");
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

export function insideRoot(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/** The workspace if it exists and belongs to this user; otherwise null (callers answer 404). */
export async function ownedWorkspace(client: FalkorClient, id: string, user: AuthUser): Promise<Workspace | null> {
  const ws = await getWorkspace(client, id);
  return ws && ws.owner === user.uid ? ws : null;
}
