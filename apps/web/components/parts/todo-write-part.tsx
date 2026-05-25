"use client";

import { ListChecks } from "lucide-react";
import clsx from "clsx";
import type { TodoAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

interface TodoItem {
  content?: unknown;
  step?: unknown;
  text?: unknown;
  description?: unknown;
  status?: unknown;
  state?: unknown;
  activeForm?: unknown;
}

interface TodoToolPartProps {
  action: TodoAction;
}

export function TodoToolPart({ action }: TodoToolPartProps) {
  const rawTodos = action.todos;
  const todos: TodoItem[] = Array.isArray(rawTodos) ? (rawTodos as TodoItem[]) : [];
  const total = todos.length;
  const completed = todos.filter((todo) => isCompleted(todo)).length;
  const summary = total > 0
    ? `Updated todos (${completed}/${total})`
    : "Updated todos";

  return (
    <ExpandableSummary
      icon={<ListChecks className="w-3.5 h-3.5" />}
      summary={summary}
      detail={
        todos.length > 0 ? (
          <div className="my-1 rounded-md border border-border bg-background-secondary px-3 py-2">
            <ul className="space-y-1 text-xs">
              {todos.map((todo, index) => {
                const status = todoStatus(todo);
                const content = todoContent(todo);
                return (
                  <li key={index} className="grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-2">
                    <span className="flex h-4 w-4 items-center justify-center text-foreground-secondary">
                      {status === "completed" ? "✓" : status === "in_progress" ? "→" : "•"}
                    </span>
                    <span className={clsx("min-w-0", status === "completed" && "text-foreground-secondary line-through")}>
                      {content}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : undefined
      }
    />
  );
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function todoContent(todo: TodoItem): string {
  return (
    asString(todo.content)
    || asString(todo.step)
    || asString(todo.text)
    || asString(todo.description)
    || asString(todo.activeForm)
  );
}

function todoStatus(todo: TodoItem): string {
  const status = asString(todo.status) || asString(todo.state);
  if (status === "done") { return "completed"; }
  return status;
}

function isCompleted(todo: TodoItem): boolean {
  return todoStatus(todo) === "completed";
}
