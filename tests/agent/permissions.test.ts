import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADAPTIVE_PRESET,
  applyPreset,
  currentPreset,
  decidePermission,
  describePermissions,
  describePreset,
  PERMISSION_PRESET_TABLE,
  RESERVED_PRESET_NAMES,
  adaptiveSettings,
  DEFAULT_PERMISSIONS,
} from "@/lib/agent/permissions";

const readOnly = { mode: "read-only", policy: "ask" } as const;
const workspace = { mode: "workspace-write", policy: "ask" } as const;
const full = { mode: "danger-full-access", policy: "never" } as const;

test("reads and network calls are always allowed", () => {
  for (const mode of [readOnly, workspace, full]) {
    assert.equal(decidePermission("ws_read", mode).outcome, "allow");
    assert.equal(decidePermission("web_search", mode).outcome, "allow");
    assert.equal(decidePermission("session_search", mode).outcome, "allow");
  }
});

test("read-only refuses writes, commands and spawns", () => {
  assert.equal(decidePermission("ws_write", readOnly).outcome, "deny");
  assert.equal(decidePermission("ws_shell", readOnly).outcome, "deny");
  assert.equal(decidePermission("runAgentTask", readOnly).outcome, "deny");
});

test("workspace mode allows writes but asks before running commands", () => {
  assert.equal(decidePermission("ws_write", workspace).outcome, "allow");
  assert.equal(decidePermission("ws_shell", workspace).outcome, "ask");
  assert.equal(decidePermission("runAgentTask", workspace).outcome, "ask");
});

test("full access allows everything", () => {
  assert.equal(decidePermission("ws_shell", full).outcome, "allow");
  assert.equal(decidePermission("runAgentTask", full).outcome, "allow");
  assert.equal(decidePermission("ws_write", full).outcome, "allow");
});

test("an approval policy of never turns a question into a refusal", () => {
  const never = { mode: "workspace-write", policy: "never" } as const;
  const decision = decidePermission("ws_shell", never);
  assert.equal(decision.outcome, "deny");
  assert.match(decision.reason, /never/);
});

test("an unknown tool is treated as a write", () => {
  assert.equal(decidePermission("mystery_tool", workspace).outcome, "allow");
  assert.equal(decidePermission("mystery_tool", readOnly).outcome, "deny");
});

test("the adaptive preset follows the workspace", () => {
  assert.equal(adaptiveSettings(true).mode, "workspace-write");
  assert.equal(adaptiveSettings(false).mode, "read-only");
  assert.equal(applyPreset("read-only", true)?.mode, "read-only");
  assert.equal(applyPreset("danger-full-access", false)?.mode, "danger-full-access");
  assert.equal(applyPreset(ADAPTIVE_PRESET, true)?.mode, "workspace-write");
  assert.equal(applyPreset("not-a-preset"), null);
});

test("the default is a workspace that asks", () => {
  assert.equal(DEFAULT_PERMISSIONS.mode, "workspace-write");
  assert.equal(DEFAULT_PERMISSIONS.policy, "ask");
  assert.match(describePermissions(DEFAULT_PERMISSIONS), /Workspace/);
});

test("the preset table bundles a sandbox mode with an approval policy", () => {
  assert.ok(PERMISSION_PRESET_TABLE.length > 0);
  for (const entry of PERMISSION_PRESET_TABLE) {
    assert.ok(entry.name.length > 0);
    assert.ok(["read-only", "workspace-write", "danger-full-access"].includes(entry.mode));
    assert.ok(["ask", "never"].includes(entry.policy));
    // The reserved names may not appear in the table.
    assert.equal(RESERVED_PRESET_NAMES.includes(entry.name), false);
  }
});

test("the current preset is the recorded one while it still matches", () => {
  const current = currentPreset(workspace, "workspace-write", false);
  assert.equal(current.name, "workspace-write");
  assert.equal(describePreset(current), "Workspace");
});

test("a recorded preset that no longer matches falls back to the first match", () => {
  // The record says "workspace-write" but the knobs are read-only now.
  const current = currentPreset(readOnly, "workspace-write", false);
  assert.equal(current.name, "read-only");
});

test("a combination that matches nothing is custom, and custom is not selectable", () => {
  const current = currentPreset({ mode: "workspace-write", policy: "never" }, null, false);
  // workspace-write + never is in the table, so it matches.
  assert.equal(current.name, "workspace-write-never");
  const options = ["read-only", "workspace-write", "workspace-write-never", "danger-full-access"];
  assert.equal(options.includes("custom"), false);
});
