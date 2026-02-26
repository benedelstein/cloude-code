"use client";

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

interface TodoWritePartProps {
  part: {
    type: string;
    toolName?: string;
    args?: unknown;
    input?: unknown;
    state?: string;
  };
}

export function TodoWritePart({ part }: TodoWritePartProps) {
  const input = (part.args ?? part.input) as { todos?: Todo[] } | undefined;
  const todos = input?.todos ?? [];

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const totalCount = todos.length;

  return (
    <div className="my-2 border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
        <ListIcon />
        <span className="font-medium text-sm flex-1">Tasks</span>
        <span className="text-xs text-muted-foreground">
          {completedCount}/{totalCount} completed
        </span>
      </div>

      {/* Todo items */}
      <div className="px-3 py-2 space-y-1.5">
        {todos.map((todo, index) => (
          <div key={index} className="flex items-start gap-2.5">
            <div className="flex-shrink-0 mt-0.5">
              <StatusIcon status={todo.status} />
            </div>
            <span
              className={`text-sm leading-snug ${
                todo.status === "completed"
                  ? "text-muted-foreground line-through"
                  : "text-foreground"
              }`}
            >
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <svg
        className="w-4 h-4 text-green-500"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    );
  }

  if (status === "in_progress") {
    return (
      <svg
        className="w-4 h-4 text-blue-500 animate-spin"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.015 4.356v4.992"
        />
      </svg>
    );
  }

  // pending
  return (
    <svg
      className="w-4 h-4 text-muted-foreground"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      className="w-4 h-4 text-muted-foreground"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
      />
    </svg>
  );
}
