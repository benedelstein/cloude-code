"use client";

import Image from "next/image";
import type { useClaudeAuth } from "@/hooks/use-claude-auth";

type ClaudeAuthState = ReturnType<typeof useClaudeAuth>;

type ClaudeSigninPanelProps = {
  claude: ClaudeAuthState;
  isExiting: boolean;
};

export function ClaudeSigninPanel({
  claude,
  isExiting,
}: ClaudeSigninPanelProps) {
  return (
    <div
      aria-hidden={isExiting}
      className={`overflow-hidden transition-all duration-200 ease-out ${
        isExiting
          ? "max-h-0 opacity-0 -translate-y-1 pointer-events-none"
          : "max-h-[640px] opacity-100 translate-y-0"
      }`}
    >
      <div className="px-4 pt-4 pb-2">
        <div className="rounded-md border border-[#d97757] p-4 bg-[#d97757]/10">
          <div className="flex items-center gap-2">
            <Image
              src="/claude_logo.svg"
              alt="Claude logo"
              width={16}
              height={16}
              className="h-4 w-4"
            />
            <h2 className="text-sm font-semibold text-foreground">
              Sign in with Claude
            </h2>
          </div>
          <p className="mt-1 text-xs text-foreground-muted">
            Follow these steps to connect your Claude account:
          </p>
          <ol className="mt-3 space-y-1 text-xs text-foreground-muted list-decimal list-inside">
            <li>
              Click the button below and authorize Claude in a new tab.
            </li>
            <li>
              Copy the code from Claude and paste it here to finish.
            </li>
          </ol>
          <div className="mt-4">
            <button
              type="button"
              onClick={claude.connect}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#d97757] text-white hover:bg-[#d97757]/90 transition-colors cursor-pointer"
            >
              Sign in with Claude
            </button>
          </div>
          {claude.error && !claude.awaitingCode && (
            <p className="mt-3 text-xs text-danger">{claude.error}</p>
          )}
          {claude.awaitingCode && (
            <div className="mt-4">
              <label className="block text-xs text-foreground-muted mb-2">
                Paste the code from Claude:
              </label>
              <input
                value={claude.code}
                onChange={(e) => claude.setCode(e.target.value)}
                placeholder="Paste code..."
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-accent/50"
                disabled={claude.submittingCode}
              />
              {claude.error && (
                <p className="mt-2 text-xs text-danger">
                  {claude.error}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={claude.submitCode}
                  disabled={!claude.code.trim() || claude.submittingCode}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-[#d97757] text-white hover:bg-[#d97757]/90 transition-colors disabled:opacity-50"
                >
                  {claude.submittingCode ? "Submitting..." : "Complete sign in"}
                </button>
                <button
                  type="button"
                  onClick={claude.cancelCodeEntry}
                  disabled={claude.submittingCode}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
