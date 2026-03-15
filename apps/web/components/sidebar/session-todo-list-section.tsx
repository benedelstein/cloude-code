"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { SessionTodo } from "@repo/shared";
import { cn } from "@/lib/utils";
import {
  SessionSidebarCard,
  SessionSidebarSection,
} from "@/components/sidebar/session-sidebar-section";

interface SessionTodoListSectionProps {
  todos: SessionTodo[] | null;
}

interface TodoItem {
  key: string;
  todo: SessionTodo;
}

const DEFAULT_VISIBLE_TODO_COUNT = 5;
const TODO_STATUS_ICON_CLASS_NAME =
  "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-200";

export function SessionTodoListSection({
  todos,
}: SessionTodoListSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const completedTodos = todos?.filter((todo) => todo.status === "completed").length ?? 0;
  const todoItems = getTodoItems(todos ?? []);
  const minHeight = "min-h-[200px]";
  const showExpandButton = todoItems.length > DEFAULT_VISIBLE_TODO_COUNT;

  useEffect(() => {
    if (todoItems.length <= DEFAULT_VISIBLE_TODO_COUNT) {
      setIsExpanded(false);
    }
  }, [todoItems.length]);

  return (
    <SessionSidebarSection
      title="Todo List"
      meta={todos && todos.length > 0 ? `${completedTodos}/${todos.length} completed` : undefined}
    >
      {todos && todos.length > 0 ? (
        <SessionSidebarCard className={minHeight}>
          <div className="flex flex-col">
            {todoItems.map((todoItem, index) => (
              <TodoListItem
                key={todoItem.key}
                todo={todoItem.todo}
                isVisible={isExpanded || index < DEFAULT_VISIBLE_TODO_COUNT}
              />
            ))}
          </div>
          {showExpandButton ? (
            <button
              type="button"
              onClick={() => setIsExpanded((currentValue) => !currentValue)}
              className="mt-1 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground"
              aria-expanded={isExpanded}
            >
              {isExpanded ? "Show less" : `Show all (${todoItems.length})`}
            </button>
          ) : null}
        </SessionSidebarCard>
      ) : (
        <SessionSidebarCard variant="empty" className={minHeight}>
          No todos.
        </SessionSidebarCard>
      )}
    </SessionSidebarSection>
  );
}

function TodoListItem({
  todo,
  isVisible,
}: {
  todo: SessionTodo;
  isVisible: boolean;
}) {
  const [hasEntered, setHasEntered] = useState(false);

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      setHasEntered(true);
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div
      aria-hidden={!isVisible}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity,margin,transform] duration-200 ease-out",
        isVisible ? "mb-2 grid-rows-[1fr] opacity-100" : "mb-0 grid-rows-[0fr] opacity-0",
        hasEntered ? "translate-y-0" : "-translate-y-1",
      )}
    >
      <div className="overflow-hidden">
        <TodoRow todo={todo} />
      </div>
    </div>
  );
}

function TodoRow({
  todo,
}: {
  todo: SessionTodo;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="pt-0.5">
        <TodoStatusIcon status={todo.status} />
      </div>
      <div className="min-w-0">
        <p className="wrap-break-word text-foreground text-xs font-medium transition-colors duration-200">
          {todo.content}
        </p>
        {todo.activeForm ? (
          <p className="wrap-break-word text-[11px] text-foreground-muted transition-colors duration-200">
            {todo.activeForm}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TodoStatusIcon({
  status,
}: {
  status: "pending" | "in_progress" | "completed";
}) {
  if (status === "completed") {
    return (
      <span
        className={cn(
          TODO_STATUS_ICON_CLASS_NAME,
          "mt-0.2 border-foreground bg-foreground text-background",
        )}
      >
        <Check className="h-3 w-3" />
      </span>
    );
  }

  if (status === "in_progress") {
    return (
      <span
        className={cn(
          TODO_STATUS_ICON_CLASS_NAME,
          "mt-0.5 border-border bg-background-secondary text-foreground-muted",
        )}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }

  return (
    <span className={cn(TODO_STATUS_ICON_CLASS_NAME, "mt-0.5 border-border bg-transparent")} />
  );
}

function getTodoItems(todos: SessionTodo[]): TodoItem[] {
  const sortedTodos = [
    ...todos.filter((todo) => todo.status !== "completed"),
    ...todos.filter((todo) => todo.status === "completed"),
  ];
  const duplicateCounts = new Map<string, number>();

  return sortedTodos.map((todo) => {
    const baseKey = `${todo.content}::${todo.activeForm ?? ""}`;
    const occurrence = (duplicateCounts.get(baseKey) ?? 0) + 1;
    duplicateCounts.set(baseKey, occurrence);

    return {
      key: `${baseKey}::${occurrence}`,
      todo,
    };
  });
}
