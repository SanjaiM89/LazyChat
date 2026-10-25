/**
 * Path canonicalization for workspace identity.
 *
 * There is exactly one canon, and it is the harness's: a workspace path is
 * fully qualified and canonicalized through `fs.realpath`, so trailing
 * slashes, `..` segments and symlinks all resolve to the same directory.
 * Uniqueness is string equality of the canonical path, which means a symlink
 * pointing at an existing workspace's directory collides with it.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Whether a path names one fixed location, without process-cwd resolution.
 *
 * @param candidate - Candidate workspace path.
 * @returns Whether the path is fully qualified.
 */
export function fullyQualifiedWorkspacePath(candidate: string): boolean {
  return path.isAbsolute(candidate);
}

/**
 * Canonicalize a fully qualified directory path.
 *
 * A relative path rejects before `realpath` could resolve it against the
 * process cwd. A path that does not exist rejects with the underlying error:
 * a workspace must point at an existing directory.
 *
 * @param candidate - The path to canonicalize.
 * @returns The canonical absolute path.
 */
export function realpathNormalize(candidate: string): string {
  if (!fullyQualifiedWorkspacePath(candidate)) {
    throw new TypeError(`Workspace path is not fully qualified: '${candidate}'`);
  }
  return fs.realpathSync(candidate);
}

/**
 * Derive the default display title from a canonical workspace path: the final
 * segment, or the root's own spelling when there is no segment.
 *
 * @param candidate - Canonical workspace path.
 * @returns The default title.
 */
export function defaultWorkspaceTitle(candidate: string): string {
  return path.basename(candidate) || path.parse(candidate).root;
}

/**
 * The live state of the directory behind a workspace. Never persisted: a
 * directory that was moved away leaves the record untouched.
 */
export type WorkspaceDirStatus = "ok" | "missing-dir";

/**
 * Whether the directory behind a workspace still exists. Uncached, so a
 * directory that comes back is reported as present again.
 *
 * @param dir - The canonical workspace path.
 * @returns The live directory status.
 */
export function workspaceDirStatus(dir: string): WorkspaceDirStatus {
  try {
    return fs.statSync(dir).isDirectory() ? "ok" : "missing-dir";
  } catch {
    return "missing-dir";
  }
}
