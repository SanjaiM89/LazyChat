import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Root directory for everything the app writes: chats, artifacts, sandboxes,
 * workspaces and the graph database.
 *
 * Normally that is `./data` next to the server. The packaged desktop app runs
 * from a read-only AppImage mount, so when `./data` cannot be written to the
 * state moves to a per-user directory instead of failing every write.
 */
function resolveDataDir(): string {
  const preferred = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(process.cwd(), "data");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const base = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");
    const fallback = path.join(base, "lazychat", "data");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

export const DATA_DIR = resolveDataDir();
