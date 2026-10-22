"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  ListChecks,
  Loader2,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/components/ui";
import type { TodoItem, TodoStatus } from "@/lib/todo-types";
import { todoCounts } from "@/lib/todo-types";
import { StateDot } from "@/components/dsh/StateDot";
import { todoProgress } from "@/components/dsh/todo-model";

/**
 * Standing task list above the composer, ported from dsh's `TodoPanel` dock.
 *
 * Collapsed by default: the header is the progress line, and the list expands
 * on demand without stealing vertical space from the conversation.
 */
export function TodoPanel({ todos }: { todos: readonly TodoItem[] }) {
  const [collapsed, setCollapsed] = React.useState(true);
  if (todos.length === 0) return null;

  return (
    <section
      className="mb-2 overflow-hidden rounded-xl border border-border bg-bg-surface-100 shadow-soft"
      aria-label="Tasks"
      data-testid="todo-panel"
    >
      <div className="flex flex-col gap-2 px-3 py-1.5">
        <button
          type="button"
          className="flex w-full items-center gap-2.5 px-0 text-left"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="grid shrink-0 place-items-center text-fg-muted" aria-hidden>
            <ListChecks size={15} />
          </span>
          <span className="shrink-0 text-[13px] font-medium leading-6 text-fg">
            Tasks
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-fg-muted">
            {todoProgress(todos)}
          </span>
          <span className="grid shrink-0 place-items-center text-fg-muted" aria-hidden>
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </button>
        {!collapsed && (
          <ul className="flex max-h-[180px] list-none flex-col gap-2 overflow-y-auto p-0">
            {todos.map((todo) => (
              <TodoLine key={todo.content} todo={todo} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function statusLabel(status: TodoStatus): string {
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In progress";
  return "Pending";
}

function TodoLine({ todo }: { todo: TodoItem }) {
  return (
    <li
      className="flex min-w-0 items-center gap-2.5 text-[13px] leading-5 text-fg-secondary"
      data-status={todo.status}
    >
      <span
        className="grid h-4 w-4 shrink-0 place-items-center"
        role="img"
        aria-label={statusLabel(todo.status)}
      >
        {/* dsh's state language: green done dot, breathing ongoing ring, idle dot. */}
        <StateDot
          state={
            todo.status === "completed"
              ? "done"
              : todo.status === "in_progress"
                ? "ongoing"
                : "idle"
          }
        />
      </span>
      <span className={cn("min-w-0 truncate", todo.status === "completed" && "text-fg-muted")}>
        {todo.content}
      </span>
    </li>
  );
}

/**
 * Transcript row for one whole-list write (dsh's `TodoRow`). The dock carries
 * the standing plan; this row records what changed and expands to the list.
 */
export function TodoCallCard({
  args,
  result,
  streaming,
  errorText,
}: {
  args?: Record<string, any>;
  result?: any;
  streaming: boolean;
  errorText?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const raw = Array.isArray(args?.todos) ? (args.todos as TodoItem[]) : [];
  const todos = Array.isArray(result?.todos) ? (result.todos as TodoItem[]) : raw;
  const counts = result?.counts ?? todoCounts(todos);
  const summary = todoProgress(todos);

  if (errorText) {
    return (
      <div className="my-1 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger animate-fade-in-up">
        <TriangleAlert size={14} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">{errorText}</span>
      </div>
    );
  }

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-border bg-bg-surface-100 animate-fade-in-up">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-hover"
      >
        <span className="grid shrink-0 place-items-center text-fg-muted" aria-hidden>
          {streaming ? <Loader2 size={14} className="animate-spin" /> : <ListChecks size={14} />}
        </span>
        <span className="shrink-0 text-[13px] font-medium text-fg">Updated todo list</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-muted">
          {summary || `${todos.length} tasks`}
        </span>
        <span className="grid shrink-0 place-items-center text-fg-muted" aria-hidden>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </button>
      {open && (
        <ul className="flex list-none flex-col gap-2 border-t border-border px-3 py-2.5">
          {todos.length === 0 ? (
            <li className="text-[12.5px] text-fg-muted">No tasks.</li>
          ) : (
            todos.map((todo) => <TodoLine key={todo.content} todo={todo} />)
          )}
          <li className="sr-only">
            {counts.pending} pending, {counts.inProgress} in progress, {counts.completed} completed
          </li>
        </ul>
      )}
    </div>
  );
}
