"use client";

import type { ClaudeAuthHandle } from "@/hooks/use-provider-auth";
import { providerSigninPrimaryButtonClassName } from "@/components/model-providers/provider-signin-panel-button-styles";

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
    <div className="space-y-4">
      <p className="text-xs text-foreground-muted">{description}</p>
      <ol className="space-y-1 text-xs text-foreground-muted list-decimal list-inside">
        <li>Click the button below and authorize Claude in a new tab.</li>
        <li>Copy the code from Claude and paste it here to finish.</li>
      </ol>
      {!handle.awaitingCode && (
        <div className="mt-4">
          <button
            type="button"
            onClick={handle.connect}
            className={providerSigninPrimaryButtonClassName}
          >
            {actionLabel}
          </button>
        </div>
      )}
      {handle.error && !handle.awaitingCode && (
        <p className="text-xs text-danger">{handle.error}</p>
      )}
      {handle.awaitingCode && (
        <div className="space-y-3">
          <label className="block text-xs text-foreground-muted">
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
            <p className="text-xs text-danger">{handle.error}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handle.submitCode}
              disabled={!handle.code.trim() || handle.submittingCode}
              className={providerSigninPrimaryButtonClassName}
            >
              {submitLabel}
            </button>
            <button
              type="button"
              onClick={handle.cancelCodeEntry}
              disabled={handle.submittingCode}
              className="px-3 py-1.5 text-sm font-medium rounded-sm border border-border text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
