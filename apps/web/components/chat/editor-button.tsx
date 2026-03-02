"use client";

import { useState } from "react";
import { openEditor } from "@/lib/api";

interface EditorButtonProps {
  sessionId: string;
  editorUrl: string | null;
  disabled: boolean;
}

export function EditorButton({ sessionId, editorUrl, disabled }: EditorButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    // If editor is already open, just navigate to it
    if (editorUrl) {
      window.open(editorUrl, "_blank");
      return;
    }

    // Open the window immediately in the click handler to avoid popup blockers.
    // We'll update the URL once the API responds.
    const editorWindow = window.open("about:blank", "_blank");

    setLoading(true);
    setError(null);
    try {
      const result = await openEditor(sessionId);
      const fullUrl = `${result.url}?tkn=${result.token}`;
      if (editorWindow && !editorWindow.closed) {
        editorWindow.location.href = fullUrl;
      } else {
        // Window was closed or blocked despite our efforts — fall back
        window.open(fullUrl, "_blank");
      }
    } catch (err) {
      // Close the blank tab on error
      if (editorWindow && !editorWindow.closed) {
        editorWindow.close();
      }
      const message = err instanceof Error ? err.message : "Failed to open editor";
      setError(message);
      console.error("Failed to open editor:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={disabled || loading}
        title={error ?? (editorUrl ? "Open editor" : "Launch VS Code editor")}
        className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded border transition-colors ${
          error
            ? "border-red-500/30 text-red-500 hover:bg-red-500/10"
            : editorUrl
              ? "border-green-500/30 text-green-500 hover:bg-green-500/10"
              : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <CodeIcon />
        {loading ? "Opening..." : editorUrl ? "Editor" : "Editor"}
      </button>
    </div>
  );
}

function CodeIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
      />
    </svg>
  );
}
