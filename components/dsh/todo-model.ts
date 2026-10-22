"use client";

import type { UIMessage } from "ai";
import { isTodoList, type TodoItem } from "@/lib/todo-types";

/**
 * Read the most recent `todo_write` snapshot from a transcript.
 *
 * dsh clears the standing plan when the next turn starts (turn/end keeps the
 * finished checklist visible), so only parts after the last user message are
 * considered. The whole list lives in the tool call itself, which makes a
 * reload and a resumed run render identically without a side store.
 */
export function latestTodos(messages: readonly UIMessage[]): TodoItem[] {
  let userIndex = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      userIndex = i;
      break;
    }
  }
  for (let i = messages.length - 1; i >= userIndex; i -= 1) {
    const parts = (messages[i] as { parts?: unknown })?.parts;
    if (!Array.isArray(parts)) continue;
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const list = snapshotFromPart(parts[j]);
      if (list) return list;
    }
  }
  return [];
}

/** Extract one part's committed todo list, if this part is a successful write. */
export function snapshotFromPart(part: unknown): TodoItem[] | null {
  if (!part || typeof part !== "object") return null;
  const p = part as Record<string, any>;

  let name: string | undefined;
  let input: any;
  let output: any;
  let state: string | undefined;

  if (p.type === "dynamic-tool") {
    name = p.toolName;
    input = p.input;
    output = p.output;
    state = p.state;
  } else if (typeof p.type === "string" && p.type.startsWith("tool-")) {
    name = p.type.slice("tool-".length);
    input = p.input;
    output = p.output;
    state = p.state;
  } else if (p.type === "tool-invocation" && p.toolInvocation) {
    name = p.toolInvocation.toolName;
    input = p.toolInvocation.args;
    output = p.toolInvocation.state === "result" ? p.toolInvocation.result : undefined;
    state = p.toolInvocation.state === "result" ? "output-available" : "input-available";
  }

  if (name !== "todo_write") return null;
  // A rejected write never mutates the standing plan in dsh: neither does it here.
  if (state === "output-error" || state === "output-denied") return null;
  if (isTodoList(output?.todos)) return output.todos;
  if (state !== "input-streaming" && isTodoList(input?.todos)) return input.todos;
  return null;
}

/** Compact "2 done · 1 active · 3 pending" summary, zero segments omitted. */
export function todoProgress(todos: readonly TodoItem[]): string {
  const done = todos.filter((t) => t.status === "completed").length;
  const active = todos.filter((t) => t.status === "in_progress").length;
  const pending = todos.length - done - active;
  return [
    ...(done > 0 ? [`${done} done`] : []),
    ...(active > 0 ? [`${active} in progress`] : []),
    ...(pending > 0 ? [`${pending} pending`] : []),
  ].join("\u2002·\u2002");
}
