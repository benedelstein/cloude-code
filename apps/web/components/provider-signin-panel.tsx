"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import type { ProviderId } from "@repo/shared";
import type {
  ClaudeAuthHandle,
  OpenAIAuthHandle,
  ProviderAuthHandleUnion,
} from "@/hooks/use-provider-auth";

type ProviderSigninPanelProps = {
  providerId: ProviderId;
  handle: ProviderAuthHandleUnion;
  isExiting: boolean;
};

const PROVIDER_META: Record<ProviderId, {
  name: string;
  icon: string;
  accentColor: string;
  accentBg: string;
}> = {
  "claude-code": {
    name: "Claude",
    icon: "/claude_logo.svg",
    accentColor: "#d97757",
    accentBg: "rgba(217, 119, 87, 0.1)",
  },
  "openai-codex": {
    name: "OpenAI Codex",
    icon: "/openai_logo.svg",
    accentColor: "var(--foreground)",
    accentBg: "var(--muted)",
  },
};

/**
 * Generic sign-in panel that renders provider-specific auth flow views.
 * Wraps both Claude (paste-code) and OpenAI Codex (device-code) flows
 * in a shared shell with consistent styling.
 */
export function ProviderSigninPanel({
  providerId,
  handle,
  isExiting,
}: ProviderSigninPanelProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const meta = PROVIDER_META[providerId];

  return (
    <div
      aria-hidden={isExiting}
      className={`overflow-hidden transition-all duration-200 ease-out ${
        isExiting || !mounted
          ? "max-h-0 opacity-0 -translate-y-1 pointer-events-none"
          : "max-h-[640px] opacity-100 translate-y-0"
      }`}
    >
      <div className="px-4 pt-4 pb-2">
        <div
          className="rounded-md border p-4"
          style={{
            borderColor: meta.accentColor,
            backgroundColor: meta.accentBg,
          }}
        >
          <div className="flex items-center gap-2">
            <Image
              src={meta.icon}
              alt={`${meta.name} logo`}
              width={16}
              height={16}
              className="h-4 w-4"
            />
            <h2 className="text-sm font-semibold text-foreground">
              {handle.requiresReauth ? `Reconnect ${meta.name}` : `Connect ${meta.name}`}
            </h2>
          </div>

          {providerId === "claude-code" ? (
            <ClaudeFlowView handle={handle as ClaudeAuthHandle} accentColor={meta.accentColor} />
          ) : (
            <OpenAIFlowView handle={handle as OpenAIAuthHandle} accentColor={meta.accentColor} />
          )}
        </div>
      </div>
    </div>
  );
}

function ClaudeFlowView({
  handle,
  accentColor,
}: {
  handle: ClaudeAuthHandle;
  accentColor: string;
}) {
  const description = handle.requiresReauth
    ? "Your Claude session expired. Reconnect your account to continue."
    : "Follow these steps to connect your Claude account:";
  const actionLabel = handle.requiresReauth ? "Reconnect Claude" : "Sign in with Claude";
  const submitLabel = handle.submittingCode ? "Submitting..." : "Complete sign in";

  return (
    <>
      <p className="mt-1 text-xs text-foreground-muted">{description}</p>
      <ol className="mt-3 space-y-1 text-xs text-foreground-muted list-decimal list-inside">
        <li>Click the button below and authorize Claude in a new tab.</li>
        <li>Copy the code from Claude and paste it here to finish.</li>
      </ol>
      {!handle.awaitingCode && (
        <div className="mt-4">
          <button
            type="button"
            onClick={handle.connect}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm text-white hover:opacity-90 transition-colors cursor-pointer"
            style={{ backgroundColor: accentColor }}
          >
            {actionLabel}
          </button>
        </div>
      )}
      {handle.error && !handle.awaitingCode && (
        <p className="mt-3 text-xs text-danger">{handle.error}</p>
      )}
      {handle.awaitingCode && (
        <div className="mt-4">
          <label className="block text-xs text-foreground-muted mb-2">
            Paste the code from Claude:
          </label>
          <input
            value={handle.code}
            onChange={(event) => handle.setCode(event.target.value)}
            placeholder="Paste code..."
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-accent/50"
            disabled={handle.submittingCode}
          />
          {handle.error && (
            <p className="mt-2 text-xs text-danger">{handle.error}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handle.submitCode}
              disabled={!handle.code.trim() || handle.submittingCode}
              className="px-3 py-1.5 text-xs font-semibold rounded-md text-white hover:opacity-90 transition-colors disabled:opacity-50"
              style={{ backgroundColor: accentColor }}
            >
              {submitLabel}
            </button>
            <button
              type="button"
              onClick={handle.cancelCodeEntry}
              disabled={handle.submittingCode}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function OpenAIFlowView({
  handle,
  accentColor,
}: {
  handle: OpenAIAuthHandle;
  accentColor: string;
}) {
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

  // Not yet started - show connect button
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

  // Device code flow active - show code and verification link
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
