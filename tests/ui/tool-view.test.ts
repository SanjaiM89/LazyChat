/**
 * Tool-view parity tests: the dsh-port ANSI parser, height cap, and terminal
 * card derivation. Pure functions, no browser and no graph.
 *
 * Run: `npm run test:ui`
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseAnsiLines } from "../../components/dsh/ansi";
import { headTailCap } from "../../components/dsh/head-tail-cap";
import {
  terminalCardModel,
  terminalFailed,
} from "../../components/dsh/terminal-card-model";

describe("parseAnsiLines", () => {
  it("returns one entry per line", () => {
    assert.deepEqual(parseAnsiLines(""), [[]]);
    assert.equal(parseAnsiLines("a\nb\nc").length, 3);
    assert.deepEqual(parseAnsiLines("a\nb\nc")[1], [{ text: "b", style: undefined }]);
  });

  it("resolves basic colors onto theme tokens", () => {
    const [line] = parseAnsiLines("\u001b[31mred\u001b[0m");
    assert.equal(line[0].text, "red");
    assert.equal(line[0].style?.color, "var(--color-danger)");
  });

  it("keeps uncolored runs wrapper-free", () => {
    const [line] = parseAnsiLines("plain");
    assert.equal(line[0].style, undefined);
  });

  it("carries decorations and truecolor", () => {
    const [line] = parseAnsiLines("\u001b[1;38;2;10;20;30mc\u001b[0m");
    assert.equal(line[0].style?.fontWeight, 700);
    assert.equal(line[0].style?.color, "rgb(10, 20, 30)");
  });

  it("strips OSC, non-CSI escapes, and inert controls", () => {
    const [line] = parseAnsiLines("\u001b]0;title\u0007\u001b(Bok\u0000");
    assert.equal(line.map((s) => s.text).join(""), "ok");
  });

  it("replays carriage returns like a terminal", () => {
    // A progress bar rewrites its line in place; the final state survives.
    const [line] = parseAnsiLines("50%\r100%");
    assert.equal(line.map((s) => s.text).join(""), "100%");
  });

  it("replays backspaces as column steps", () => {
    const [line] = parseAnsiLines("abc\b\bz");
    assert.equal(line.map((s) => s.text).join(""), "az");
  });

  it("splits runs across a newline so SGR carries to the next line", () => {
    const lines = parseAnsiLines("\u001b[32mgreen\nstill green\u001b[0m");
    assert.equal(lines.length, 2);
    assert.equal(lines[1][0].style?.color, "var(--color-success)");
  });
});

describe("headTailCap", () => {
  it("does not cap a list inside the limit", () => {
    const cap = headTailCap(5, 16, false);
    assert.equal(cap.hidden, -11);
    assert.equal(cap.capped, false);
  });

  it("splits an over-limit list head/tail on collapse", () => {
    const cap = headTailCap(40, 16, false);
    assert.equal(cap.hidden, 24);
    assert.equal(cap.capped, true);
    assert.equal(cap.headLines, 8);
    assert.equal(cap.tailLines, 8);
  });

  it("uncaps when expanded", () => {
    assert.equal(headTailCap(40, 16, true).capped, false);
  });
});

describe("terminalCardModel", () => {
  it("ignores tools that are not shell calls", () => {
    assert.equal(terminalCardModel("ws_read", { path: "a.ts" }, {}, undefined), null);
  });

  it("ignores a shell call with no command", () => {
    assert.equal(terminalCardModel("ws_shell", {}, { exit_code: 0 }, undefined), null);
    assert.equal(terminalCardModel("ws_shell", { command: "   " }, { exit_code: 0 }, undefined), null);
  });

  it("renders a running call with no output and no status", () => {
    const model = terminalCardModel("ws_shell", { command: "npm test" }, undefined, undefined, "/w/app");
    assert.ok(model);
    assert.equal(model.running, true);
    assert.equal(model.output, undefined);
    assert.equal(model.exitCode, undefined);
    assert.equal(model.cwd, "/w/app");
    assert.equal(terminalFailed(model), false);
  });

  it("settles a clean run at exit 0", () => {
    const model = terminalCardModel(
      "ws_shell",
      { command: "ls" },
      { exit_code: 0, output: "a\nb\n" },
      undefined,
    );
    assert.ok(model);
    assert.equal(model.exitCode, 0);
    assert.equal(model.output, "a\nb\n");
    assert.equal(terminalFailed(model), false);
  });

  it("reports a non-zero exit as a failure without an error text", () => {
    const model = terminalCardModel(
      "ws_shell",
      { command: "false" },
      { exit_code: 127, output: "not found" },
      undefined,
    );
    assert.ok(model);
    assert.equal(terminalFailed(model), true);
  });

  it("reads a signal out of the output instead of an exit code", () => {
    const model = terminalCardModel(
      "ws_shell",
      { command: "sleep 99" },
      { output: "signal: SIGKILL\npartial" },
      undefined,
    );
    assert.ok(model);
    assert.equal(model.signal, "SIGKILL");
    assert.equal(model.exitCode, null);
    assert.equal(model.output, "partial");
    assert.equal(terminalFailed(model), true);
  });

  it("falls back to the generic path on an errored call", () => {
    // dsh keeps errors generic: the error text is the real message, and no
    // exit status is invented for a call that never settled.
    assert.equal(
      terminalCardModel("ws_shell", { command: "x" }, { exit_code: 0 }, "shell unavailable"),
      null,
    );
  });

  it("prefers a tool-authored description over the generic summary", () => {
    const model = terminalCardModel(
      "ws_shell",
      { command: "ls", description: "List the project root" },
      { exit_code: 0, output: "" },
      undefined,
    );
    assert.equal(model?.description, "List the project root");
  });

  it("resolves a workdir against the session workspace", () => {
    const model = terminalCardModel(
      "ws_shell",
      { command: "ls", workdir: "src" },
      { exit_code: 0, output: "" },
      undefined,
      "/w/app",
    );
    assert.equal(model?.cwd, "src");
  });
});