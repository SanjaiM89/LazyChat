import { test } from "node:test";
import assert from "node:assert/strict";

// Must come first: it points the app's data root at a throwaway directory.
import "./setup";
import {
  archiveSession,
  pinSession,
  readSessionState,
  unarchiveSession,
  unpinSession,
} from "@/lib/agent/session-state";

/** Each case starts from an empty registry. */
async function reset(): Promise<void> {
  const state = await readSessionState();
  for (const id of state.pinned) await unpinSession(id);
  for (const id of state.archived) await unarchiveSession(id);
}

test("pinning a session heads the pinned list and leaves the archive", async () => {
  await reset();
  await pinSession("a");
  await pinSession("b");
  const state = await readSessionState();
  // Most recently pinned first.
  assert.deepEqual(state.pinned, ["b", "a"]);
  assert.deepEqual(state.archived, []);
});

test("archiving a session drops its pin", async () => {
  await reset();
  await pinSession("a");
  const state = await archiveSession("a");
  assert.deepEqual(state.pinned, []);
  assert.deepEqual(state.archived, ["a"]);
});

test("pinning a session restores it from the archive", async () => {
  await reset();
  await archiveSession("a");
  const state = await pinSession("a");
  assert.deepEqual(state.pinned, ["a"]);
  assert.deepEqual(state.archived, []);
});

test("unpinning leaves a session where it is", async () => {
  await reset();
  await pinSession("a");
  const state = await unpinSession("a");
  assert.deepEqual(state.pinned, []);
  assert.deepEqual(state.archived, []);
});

test("unarchiving restores a session without pinning it", async () => {
  await reset();
  await archiveSession("a");
  const state = await unarchiveSession("a");
  assert.deepEqual(state.pinned, []);
  assert.deepEqual(state.archived, []);
});

test("archiving twice keeps one entry", async () => {
  await reset();
  await archiveSession("a");
  const state = await archiveSession("a");
  assert.deepEqual(state.archived, ["a"]);
});
