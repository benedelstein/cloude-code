"use client";

import type { ClaudeAuthHandle } from "@/hooks/use-provider-auth";

type ProviderSigninPanelClaudeFlowProps = {
  handle: ClaudeAuthHandle;
};

export function ProviderSigninPanelClaudeFlow({
  handle,
}: ProviderSigninPanelClaudeFlowProps) {
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
            className="inline-flex items-center gap-1.5 rounded-sm bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:opacity-90 cursor-pointer"
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
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:opacity-90 disabled:opacity-50"
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
