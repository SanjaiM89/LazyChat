/**
 * Todo-list value semantics shared by the model tool and the client dock.
 *
 * Ported from dsh's `tool-todo`: the model sends the *whole* list on every
 * call, the server canonicalizes it (trimmed, unique, non-empty content and at
 * most one active item), and the UI renders the latest snapshot. Keeping the
 * pure part here lets the browser compute counts without importing the
 * server-only tool module.
 */

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export interface TodoCounts {
  pending: number;
  inProgress: number;
  completed: number;
}

/**
 * Canonicalize a model-supplied list.
 *
 * Throws the same messages dsh throws, because the model sees these strings as
 * tool errors and should be able to correct itself from them.
 */
export function normalizeTodos(
  raw: readonly { content: string; status: TodoStatus }[],
  allowParallelInProgress = false,
): TodoItem[] {
  const todos: TodoItem[] = [];
  const seen = new Set<string>();
  let active = 0;
  for (const item of raw) {
    const content = item.content.trim();
    if (content.length === 0) {
      throw new Error("invalid todo: `content` must be a non-empty string");
    }
    if (seen.has(content)) {
      throw new Error(`invalid todos: duplicate content ${JSON.stringify(content)}`);
    }
    seen.add(content);
    if (item.status === "in_progress") active += 1;
    todos.push({ content, status: item.status });
  }
  if (!allowParallelInProgress && active > 1) {
    throw new Error(
      `invalid todos: at most one task may be in_progress (got ${active})`,
    );
  }
  return todos;
}

export function todoCounts(todos: readonly TodoItem[]): TodoCounts {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  for (const todo of todos) {
    if (todo.status === "completed") completed += 1;
    else if (todo.status === "in_progress") inProgress += 1;
    else pending += 1;
  }
  return { pending, inProgress, completed };
}

/** Whether a value is a well-formed todo list (used when reading tool args). */
export function isTodoList(value: unknown): value is TodoItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as TodoItem).content === "string" &&
        ((item as TodoItem).status === "pending" ||
          (item as TodoItem).status === "in_progress" ||
          (item as TodoItem).status === "completed"),
    )
  );
}
