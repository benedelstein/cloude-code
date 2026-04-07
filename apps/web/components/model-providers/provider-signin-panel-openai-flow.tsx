"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Check, TriangleAlert } from "lucide-react";
import type { OpenAIAuthHandle } from "@/hooks/use-provider-auth";

type ProviderSigninPanelOpenAIFlowProps = {
  handle: OpenAIAuthHandle;
};

export function ProviderSigninPanelOpenAIFlow({
  handle,
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
  const deviceAuthNotice = (
    <div className="mt-3 rounded-md border border-warning/20 bg-warning/10 px-3 py-2.5 text-xs text-foreground">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <div>
          <p className="font-medium text-warning">
            Make sure to enable device-code authentication in{" "}
            <Link
              href="https://chatgpt.com/#settings/Security"
              target="_blank"
              rel="noopener noreferrer"
              className="text-warning underline underline-offset-2 hover:text-warning/80 transition-colors"
            >
              ChatGPT Security settings
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );

  if (!handle.attemptId) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-foreground-muted">{description}</p>
        {deviceAuthNotice}
        <div>
          <button
            type="button"
            onClick={handle.connect}
            className="inline-flex mt-4 items-center gap-1.5 rounded-sm bg-foreground px-3 py-1.5 text-sm font-semibold text-background transition-colors hover:opacity-90 cursor-pointer"
          >
            {handle.requiresReauth ? "Reconnect OpenAI" : "Sign in with ChatGPT"}
          </button>
        </div>
        {handle.error && (
          <p className="text-xs text-danger">{handle.error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-foreground-muted">
        Enter this code on the OpenAI authorization page:
      </p>
      <div className="flex items-center gap-2">
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
      <p className="inline-flex items-center gap-2 text-xs text-foreground-muted italic animate-pulse">
        Waiting for authorization...
      </p>
      {handle.error && (
        <p className="text-xs text-danger">{handle.error}</p>
      )}
    </div>
  );
}
