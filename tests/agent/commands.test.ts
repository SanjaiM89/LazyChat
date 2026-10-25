/**
 * The slash-command registry and the permission presets.
 *
 * A command answers itself: it never becomes a model message. The permission
 * preset it reports and switches is the harness's model — a named bundle of a
 * sandbox mode and an approval policy, with a derived `custom` state for a
 * combination that matches none.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { commandNameOf, findCommand, listCommands, registerCommand } from "@/lib/agent/commands";
import {
  ADAPTIVE_PRESET,
  applyPreset,
  currentPreset,
  presetOptions,
} from "@/lib/agent/permissions";

const workspace = { mode: "workspace-write", policy: "ask" } as const;

describe("the command registry", () => {
  it("knows the commands it ships with", () => {
    const names = listCommands().map((command) => command.name);
    assert.ok(names.includes("permission"));
    assert.ok(names.includes("plan"));
    assert.ok(names.includes("help"));
  });

  it("refuses a duplicate name", () => {
    registerCommand({ name: "test-duplicate", description: "x", run: async () => ({ message: "" }) });
    assert.throws(
      () => registerCommand({ name: "test-duplicate", description: "x", run: async () => ({ message: "" }) }),
      /already registered/,
    );
  });

  it("finds the command a line asks for", () => {
    assert.equal(commandNameOf("/permission"), "permission");
    assert.equal(commandNameOf("/permission workspace-write"), "permission");
    assert.equal(commandNameOf("/help me"), "help");
    assert.equal(commandNameOf("not a command"), null);
    assert.equal(commandNameOf(""), null);
  });
});

describe("the permission command", () => {
  it("reports the current preset and the available ones", async () => {
    const command = findCommand("permission");
    assert.ok(command);
    const outcome = await command.run({
      argument: "",
      permissions: workspace,
      preset: "workspace-write",
      hasWorkspace: false,
      userId: "local",
    });
    assert.match(outcome.message, /workspace-write/);
    assert.match(outcome.message, /read-only/);
    assert.equal(outcome.permissions, undefined);
  });

  it("switches to another preset", async () => {
    const command = findCommand("permission");
    assert.ok(command);
    const outcome = await command.run({
      argument: "read-only",
      permissions: workspace,
      preset: "workspace-write",
      hasWorkspace: false,
      userId: "local",
    });
    assert.deepEqual(outcome.permissions, { mode: "read-only", policy: "ask" });
    assert.equal(outcome.preset, "read-only");
  });

  it("refuses a preset that does not exist", async () => {
    const command = findCommand("permission");
    assert.ok(command);
    const outcome = await command.run({
      argument: "not-a-preset",
      permissions: workspace,
      preset: "workspace-write",
      hasWorkspace: false,
      userId: "local",
    });
    assert.equal(outcome.error, true);
    assert.match(outcome.message, /no permission preset/);
  });
});

describe("the preset options", () => {
  it("never offers custom", () => {
    const names = presetOptions(true).map((option) => option.name);
    assert.equal(names.includes("custom"), false);
    assert.ok(names.includes(ADAPTIVE_PRESET));
  });

  it("resolves the adaptive preset against the workspace", () => {
    assert.equal(applyPreset(ADAPTIVE_PRESET, true)?.mode, "workspace-write");
    assert.equal(applyPreset(ADAPTIVE_PRESET, false)?.mode, "read-only");
  });

  it("keeps custom derived, not stored", () => {
    // A combination that is in the table resolves to that entry.
    const current = currentPreset({ mode: "danger-full-access", policy: "ask" }, null, false);
    assert.equal(current.name, "custom");
    assert.equal(current.entry, null);
  });
});
