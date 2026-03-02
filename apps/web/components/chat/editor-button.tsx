"use client";

import { useState, useEffect } from "react";
import { openEditor } from "@/lib/api";

interface EditorButtonProps {
  sessionId: string;
  editorUrl: string | null;
  disabled: boolean;
}

export function EditorButton({ sessionId, editorUrl, disabled }: EditorButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorLink, setEditorLink] = useState<string | null>(null);

  // When editorUrl is set (e.g. from state on page load), eagerly fetch the token
  useEffect(() => {
    if (editorUrl && !editorLink) {
      openEditor(sessionId)
        .then((result) => setEditorLink(`${result.url}?tkn=${result.token}`))
        .catch(() => {/* will fetch on click instead */});
    }
  }, [editorUrl, editorLink, sessionId]);

  async function handleClick(event: React.MouseEvent) {
    // If we already have the link, let the <a> handle it natively
    if (editorLink) return;

    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await openEditor(sessionId);
      const fullUrl = `${result.url}?tkn=${result.token}`;
      setEditorLink(fullUrl);
      // Navigate now — opens in new tab via the link's target="_blank"
      window.open(fullUrl, "_blank");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open editor";
      setError(message);
      console.error("Failed to open editor:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <a
      href={editorLink ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      title={error ?? "Open hosted VS Code to make manual edits"}
      className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded border transition-colors ${
        error
          ? "border-red-500/30 text-red-500 hover:bg-red-500/10"
          : editorLink
            ? "border-green-500/30 text-green-500 hover:bg-green-500/10"
            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      } ${disabled || loading ? "opacity-50 pointer-events-none" : ""}`}
    >
      <CodeIcon />
      {loading ? "Opening..." : "Editor"}
    </a>
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
