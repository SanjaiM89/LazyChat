/**
 * The read-before-write observation policy.
 *
 * A file tool may only overwrite or edit a file the session has read. The
 * record of what was read is a prior observation: a file is unseen, confirmed
 * absent, or present at a version. Reading a missing path confirms its
 * absence, so a later write may recreate it, but a file that changed since it
 * was read is refused.
 *
 * The observations live for the session that made them and are never
 * persisted: a resumed session starts with nothing observed and has to read
 * its targets again.
 */
import fs from "node:fs";

export type Observation = { kind: "present"; version: string } | { kind: "absent" };

export type GuardCode = "FS_NOT_OBSERVED" | "FS_NOT_FOUND" | "FS_STALE_VERSION";

export interface GuardFailure {
  ok: false;
  code: GuardCode;
  /** The policy reason, in the harness's wording. */
  reason: string;
}

export type GuardResult = { ok: true } | GuardFailure;

const observations = new Map<string, Map<string, Observation>>();
const MAX_SESSIONS = 512;

function bucket(owner: string): Map<string, Observation> {
  let map = observations.get(owner);
  if (!map) {
    map = new Map();
    observations.set(owner, map);
    // Bound the memory: the oldest session's observations go first.
    while (observations.size > MAX_SESSIONS) {
      const oldest = observations.keys().next().value;
      if (oldest === undefined) break;
      observations.delete(oldest);
    }
  }
  return map;
}

/**
 * The version token of a file: its size and modification time. A file whose
 * token changed is a different version of the same path.
 */
export function versionOf(target: string): string | null {
  try {
    const st = fs.statSync(target);
    if (!st.isFile()) return null;
    return `${st.size}:${Math.floor(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

/** Record that the owner read the target, and what it saw. */
export function recordObservation(owner: string, target: string): Observation {
  const version = versionOf(target);
  const observation: Observation = version ? { kind: "present", version } : { kind: "absent" };
  bucket(owner).set(target, observation);
  return observation;
}

/** What the owner last observed at the target, if anything. */
export function observationOf(owner: string, target: string): Observation | undefined {
  return observations.get(owner)?.get(target);
}

/** Forget everything the owner observed. */
export function clearObservations(owner: string): void {
  observations.delete(owner);
}

/**
 * Guard a write.
 *
 * A file that does not exist may be created. A file that exists may only be
 * overwritten when the owner read it, and only while it is still the version
 * that was read.
 */
export function guardWrite(owner: string, target: string): GuardResult {
  const version = versionOf(target);
  if (version === null) {
    // Creating a new file: allowed, but a file that was observed present and
    // has since appeared must not be clobbered.
    const seen = observationOf(owner, target);
    if (seen?.kind === "present") {
      return {
        ok: false,
        code: "FS_STALE_VERSION",
        reason: `cannot modify "${target}": the file appeared since it was read`,
      };
    }
    return { ok: true };
  }
  const seen = observationOf(owner, target);
  if (!seen) {
    return {
      ok: false,
      code: "FS_NOT_OBSERVED",
      reason: `cannot modify "${target}": file has not been read — read the file, then retry`,
    };
  }
  if (seen.kind === "absent") {
    return {
      ok: false,
      code: "FS_STALE_VERSION",
      reason: `cannot modify "${target}": the file appeared since it was read`,
    };
  }
  if (seen.version !== version) {
    return {
      ok: false,
      code: "FS_STALE_VERSION",
      reason: `cannot modify "${target}": the file changed since it was read — read the file, then retry`,
    };
  }
  return { ok: true };
}

/**
 * Guard an edit.
 *
 * An edit always needs a prior read of the target: a file that was observed
 * absent cannot be edited, and one that has changed since it was read is
 * refused.
 */
export function guardEdit(owner: string, target: string): GuardResult {
  const seen = observationOf(owner, target);
  if (!seen) {
    return {
      ok: false,
      code: "FS_NOT_OBSERVED",
      reason: `cannot modify "${target}": file has not been read — read the file, then retry`,
    };
  }
  if (seen.kind === "absent") {
    return {
      ok: false,
      code: "FS_NOT_FOUND",
      reason: `cannot modify "${target}": the file was read as missing`,
    };
  }
  const version = versionOf(target);
  if (version === null || version !== seen.version) {
    return {
      ok: false,
      code: "FS_STALE_VERSION",
      reason: `cannot modify "${target}": the file changed since it was read — read the file, then retry`,
    };
  }
  return { ok: true };
}
