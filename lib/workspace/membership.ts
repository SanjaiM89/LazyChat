/**
 * Workspace membership.
 *
 * The harness does not store a workspace id on a session: a session belongs to
 * the workspace whose path equals the session's canonical working directory.
 * A session that moved elsewhere leaves the membership, and a session whose
 * directory is gone never joins one.
 *
 * Omnia derives the same thing: the membership is computed from the
 * conversations' working directories, so it cannot drift from them.
 */
import { canonicalPath } from "./workspaces";

export interface WorkspaceMember {
  id: string;
  title: string;
  /** The session's canonical working directory. */
  cwd: string;
  updatedAt: number;
}

/**
 * The sessions that run in a workspace.
 *
 * @param sessions - Sessions with a working directory.
 * @param workspacePath - The workspace's canonical path.
 * @returns The sessions whose canonical directory equals the workspace path.
 */
export function membersOf(sessions: WorkspaceMember[], workspacePath: string): WorkspaceMember[] {
  const target = canonicalPath(workspacePath);
  return sessions.filter((s) => {
    if (!s.cwd) return false;
    try {
      return canonicalPath(s.cwd) === target;
    } catch {
      return false;
    }
  });
}
