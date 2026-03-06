"use client";

import { useState, useEffect } from "react";
import { Code } from "lucide-react";
import { openEditor } from "@/lib/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
      // Navigate now - opens in new tab via the link's target="_blank"
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
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={editorLink ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border transition-colors ${
            error
              ? "border-danger/30 text-danger hover:bg-danger/10"
              : editorLink
                ? "border-success/30 text-success hover:bg-success/10"
                : "border-border text-foreground-muted hover:bg-accent-subtle hover:text-foreground"
          } ${disabled || loading ? "opacity-50 pointer-events-none" : ""}`}
        >
          <Code className="h-3.5 w-3.5" />
          {loading ? "Opening..." : "Open Editor"}
        </a>
      </TooltipTrigger>
      <TooltipContent>
        {error ?? "Open hosted VS Code to make manual edits"}
      </TooltipContent>
    </Tooltip>
  );
}
