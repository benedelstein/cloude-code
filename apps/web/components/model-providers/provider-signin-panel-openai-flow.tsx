"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { OpenAIAuthHandle } from "@/hooks/use-provider-auth";

type ProviderSigninPanelOpenAIFlowProps = {
  handle: OpenAIAuthHandle;
  accentColor: string;
};

export function ProviderSigninPanelOpenAIFlow({
  handle,
  accentColor,
}: ProviderSigninPanelOpenAIFlowProps) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!handle.userCode) return;
    await navigator.clipboard.writeText(handle.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const description = handle.requiresReauth
    ? "Your OpenAI Codex session expired. Reconnect to continue."
    : "Connect your OpenAI account to use Codex models.";

  if (!handle.attemptId) {
    return (
      <>
        <p className="mt-1 text-xs text-foreground-muted">{description}</p>
        <div className="mt-4">
          <button
            type="button"
            onClick={handle.connect}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm bg-foreground text-background hover:opacity-90 transition-colors cursor-pointer"
            style={accentColor !== "var(--foreground)" ? { backgroundColor: accentColor, color: "white" } : undefined}
          >
            {handle.requiresReauth ? "Reconnect OpenAI" : "Connect OpenAI"}
          </button>
        </div>
        {handle.error && (
          <p className="mt-3 text-xs text-danger">{handle.error}</p>
        )}
      </>
    );
  }

  return (
    <>
      <p className="mt-1 text-xs text-foreground-muted">
        Enter this code on the OpenAI authorization page:
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 px-3 py-2 text-sm font-mono font-bold text-center rounded-md border border-border bg-background tracking-widest">
          {handle.userCode}
        </code>
        <button
          type="button"
          onClick={copyCode}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted transition-colors cursor-pointer"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-foreground-muted" />
          )}
        </button>
      </div>
      <p className="mt-3 text-xs text-foreground-muted">
        Waiting for authorization...
      </p>
      {handle.error && (
        <p className="mt-2 text-xs text-danger">{handle.error}</p>
      )}
    </>
  );
}
