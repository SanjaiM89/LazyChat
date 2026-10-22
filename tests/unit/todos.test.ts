/**
 * Todo-list semantics, ported from dsh's tool-todo.
 *
 * dsh sends the whole list on every call and rejects malformed lists at the
 * tool boundary. These tests pin the canonicalization, counts, and wire output
 * the model and UI both depend on.
 *
 * Run: npx tsx --test tests/unit/todos.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isTodoList,
  normalizeTodos,
  todoCounts,
  type TodoItem,
} from "@/lib/todo-types";
import { buildTodoTools } from "@/lib/todos";
import { latestTodos, snapshotFromPart, todoProgress } from "@/components/dsh/todo-model";

const tool = () => buildTodoTools({ conversationId: "conv-1" }).todo_write;

describe("normalizeTodos", () => {
  it("trims content and keeps order", () => {
    const list = normalizeTodos([
      { content: "  read the code  ", status: "in_progress" },
      { content: "write the fix", status: "pending" },
    ]);
    assert.deepEqual(list, [
      { content: "read the code", status: "in_progress" },
      { content: "write the fix", status: "pending" },
    ]);
  });

  it("rejects empty content", () => {
    assert.throws(
      () => normalizeTodos([{ content: "   ", status: "pending" }]),
      /content.*non-empty/,
    );
  });

  it("rejects duplicate content after trimming", () => {
    assert.throws(
      () =>
        normalizeTodos([
          { content: "step", status: "pending" },
          { content: " step ", status: "pending" },
        ]),
      /duplicate content "step"/,
    );
  });

  it("rejects more than one in_progress item", () => {
    assert.throws(
      () =>
        normalizeTodos([
          { content: "a", status: "in_progress" },
          { content: "b", status: "in_progress" },
        ]),
      /at most one task may be in_progress \(got 2\)/,
    );
  });

  it("allows parallel work when the deployment opts in", () => {
    const list = normalizeTodos(
      [
        { content: "a", status: "in_progress" },
        { content: "b", status: "in_progress" },
      ],
      true,
    );
    assert.equal(list.length, 2);
  });
});

describe("todoCounts", () => {
  it("counts every status", () => {
    const list: TodoItem[] = [
      { content: "a", status: "completed" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "pending" },
      { content: "d", status: "pending" },
    ];
    assert.deepEqual(todoCounts(list), { pending: 2, inProgress: 1, completed: 1 });
  });
});

describe("isTodoList", () => {
  it("accepts a well-formed list and rejects forged values", () => {
    assert.equal(isTodoList([{ content: "a", status: "pending" }]), true);
    assert.equal(isTodoList([{ content: "a", status: "later" }]), false);
    assert.equal(isTodoList([{ content: 1, status: "pending" }]), false);
    assert.equal(isTodoList(null), false);
  });
});

describe("todo_write tool", () => {
  it("returns the canonical list and counts", async () => {
    const value = (await tool().execute!(
      {
        todos: [
          { content: "  inspect  ", status: "completed" },
          { content: "change it", status: "in_progress" },
        ],
      } as never,
      {} as never,
    )) as any;
    assert.deepEqual(value.todos, [
      { content: "inspect", status: "completed" },
      { content: "change it", status: "in_progress" },
    ]);
    assert.deepEqual(value.counts, { pending: 0, inProgress: 1, completed: 1 });
  });

  it("fails validation as a tool error, not a silent no-op", async () => {
    await assert.rejects(
      () =>
        tool().execute!(
          { todos: [{ content: " ", status: "pending" }] } as never,
          {} as never,
        ) as Promise<unknown>,
      /non-empty/,
    );
  });
});

describe("transcript projection", () => {
  const list: TodoItem[] = [
    { content: "a", status: "completed" },
    { content: "b", status: "in_progress" },
  ];
  const user = (text = "do it") => ({
    id: `u-${text}`,
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
  });
  const write = (todos: TodoItem[]) => ({
    id: "a-1",
    role: "assistant" as const,
    parts: [
      {
        type: "tool-todo_write",
        toolCallId: "call-1",
        state: "output-available",
        input: { todos },
        output: { todos, counts: todoCounts(todos) },
      },
    ],
  });

  it("reads the latest committed snapshot from a typed tool part", () => {
    assert.deepEqual(latestTodos([user(), write(list)] as never), list);
  });

  it("reads a dynamic tool part and the pending input", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "todo_write",
      state: "input-available",
      input: { todos: list },
    };
    assert.deepEqual(snapshotFromPart(part), list);
  });

  it("ignores rejected writes", () => {
    const part = {
      type: "tool-todo_write",
      state: "output-error",
      input: { todos: list },
      errorText: "invalid",
    };
    assert.equal(snapshotFromPart(part), null);
  });

  it("clears at the next turn start", () => {
    assert.deepEqual(latestTodos([user(), write(list)] as never), list);
    assert.deepEqual(latestTodos([user(), write(list), user("next")] as never), []);
  });

  it("formats progress without zero segments", () => {
    assert.equal(todoProgress(list), "1 done\u2002·\u20021 in progress");
  });
});
