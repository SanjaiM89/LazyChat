import { readScoped, writeScoped } from "@/lib/store";

/**
 * The registry-global session sets.
 *
 * Pinning and archival are session state layered over the workspace account,
 * not workspace state: an archived session keeps its slot so unarchiving
 * restores it, and the two sets are mutually exclusive — archiving a session
 * drops its pin. The pinned set is in pin order, most recently pinned first.
 */
export interface SessionState {
  /** The pinned sessions, most recently pinned first. */
  pinned: string[];
  /** The archived sessions. */
  archived: string[];
}

const NAME = "session-state.json";
const EMPTY: SessionState = { pinned: [], archived: [] };

function normalise(raw: unknown): SessionState {
  const value = (raw ?? {}) as Partial<SessionState>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { pinned: list(value.pinned), archived: list(value.archived) };
}

export async function readSessionState(): Promise<SessionState> {
  try {
    return normalise(await readScoped<unknown>(NAME, EMPTY));
  } catch {
    return { ...EMPTY };
  }
}

async function write(state: SessionState): Promise<SessionState> {
  await writeScoped(NAME, state);
  return state;
}

/** Pin a session: it leaves the archive and heads the pinned list. */
export async function pinSession(id: string): Promise<SessionState> {
  const state = await readSessionState();
  return write({
    pinned: [id, ...state.pinned.filter((x) => x !== id)],
    archived: state.archived.filter((x) => x !== id),
  });
}

/** Drop a session's pin, leaving it where it is. */
export async function unpinSession(id: string): Promise<SessionState> {
  const state = await readSessionState();
  return write({ pinned: state.pinned.filter((x) => x !== id), archived: state.archived });
}

/** Archive a session: it leaves the pinned list and keeps its slot. */
export async function archiveSession(id: string): Promise<SessionState> {
  const state = await readSessionState();
  return write({
    pinned: state.pinned.filter((x) => x !== id),
    archived: state.archived.includes(id) ? state.archived : [...state.archived, id],
  });
}

/** Restore an archived session to the list it came from. */
export async function unarchiveSession(id: string): Promise<SessionState> {
  const state = await readSessionState();
  return write({ pinned: state.pinned, archived: state.archived.filter((x) => x !== id) });
}
