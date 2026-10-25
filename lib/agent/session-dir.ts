/**
 * The session's working directory.
 *
 * The harness treats the cwd as a property of the session, not of the
 * workspace: a session starts in the workspace's directory and can move
 * elsewhere with `working_directory`. A relative change resolves against the
 * current directory, and the directory is canonicalized, so a symlink and its
 * target are the same place.
 *
 * Every directory-bound tool reads this one value, so a move is felt by the
 * whole tool set at once.
 */
import fs from "node:fs";
import nodePath from "node:path";

export interface SessionDirectory {
  /** The session's current directory. */
  readonly cwd: string;
  /** Move the session into a directory. A relative path resolves against the current one. */
  set(dir: string): { cwd: string } | { error: string };
  /** The current directory, as a tool result. */
  read(): { cwd: string };
}

/**
 * Create a session directory.
 *
 * @param initial - Where the session starts. It must exist; a missing start
 *   directory falls back to the process cwd so a session is never stranded.
 */
export function createSessionDirectory(initial: string): SessionDirectory {
  const state = { cwd: usableDirectory(initial) };

  return {
    get cwd() {
      return state.cwd;
    },
    set(dir: string): { cwd: string } | { error: string } {
      const resolved = nodePath.resolve(state.cwd, dir);
      try {
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) return { error: `${resolved} is not a directory.` };
      } catch {
        return { error: `cannot enter '${dir}': ${resolved} does not exist.` };
      }
      // Canonicalized: the session's directory is a real place, not a spelling.
      try {
        state.cwd = fs.realpathSync(resolved);
      } catch {
        state.cwd = resolved;
      }
      return { cwd: state.cwd };
    },
    read() {
      return { cwd: state.cwd };
    },
  };
}

/**
 * The canonical form of a directory that exists, or the process cwd when it
 * does not. A workspace whose folder was moved away leaves the session in
 * the last directory that did work.
 */
export function usableDirectory(dir: string): string {
  try {
    const stat = fs.statSync(dir);
    if (stat.isDirectory()) return fs.realpathSync(dir);
  } catch {
    // fall through to the process cwd
  }
  return process.cwd();
}
