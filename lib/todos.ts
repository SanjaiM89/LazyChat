import { tool } from "ai";
import { z } from "zod";

import { normalizeTodos, todoCounts } from "@/lib/todo-types";

/**
 * Model-facing task list, ported from dsh's `tool-todo`.
 *
 * Server-only by construction (imported from `lib/tools.ts`); kept free of the
 * `server-only` marker so its pure wire behavior is unit-testable.
 *
 * The tool is a pure whole-list replacement: the transcript keeps every
 * snapshot, so the UI can render the latest one and the model sees its own
 * history. There is no server-side store to drift out of sync with a resumed
 * or compacted conversation.
 */
export function buildTodoTools(opts: { conversationId?: string }) {
  return {
    todo_write: tool({
      description:
        "Record and update a task list to plan multi-step work and show progress; skip it for trivial " +
        "single-step tasks. Add one todo per concrete step before you start. While work remains, keep " +
        "exactly one todo `in_progress`. Mark each todo `completed` as soon as it is done.",
      inputSchema: z.object({
        todos: z
          .array(
            z.object({
              content: z
                .string()
                .describe("One concrete step. Non-empty and unique within the list."),
              status: z
                .enum(["pending", "in_progress", "completed"])
                .describe("pending | in_progress | completed"),
            }),
          )
          .describe("The complete task list. Replaces the previous list."),
      }),
      execute: async ({ todos }) => {
        if (!opts.conversationId) {
          // A session task list without a session has nowhere to live. dsh
          // rejects the same call for the same reason.
          throw new Error("todo_write requires an owning agent session");
        }
        const list = normalizeTodos(todos);
        return {
          todos: list,
          counts: todoCounts(list),
        };
      },
    }),
  };
}
