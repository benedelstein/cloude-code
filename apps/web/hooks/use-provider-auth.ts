"use client";

import { useCallback, useMemo } from "react";
import { useClaudeAuth } from "@/hooks/use-claude-auth";
import { useOpenAIAuth } from "@/hooks/use-openai-auth";
import type { ProviderId } from "@repo/shared";

/** Minimal shared shape for provider connection state and actions. */
export type ProviderAuthHandle = {
  providerId: ProviderId;
  connected: boolean;
  requiresReauth: boolean;
  loading: boolean;
  error: string | null;
  /** Start the auth flow for this provider. */
  connect: () => Promise<void>;
  /** Disconnect this provider. */
  disconnect: () => Promise<void>;
};

export type ClaudeAuthHandle = ProviderAuthHandle & {
  providerId: "claude-code";
  awaitingCode: boolean;
  code: string;
  setCode: (code: string) => void;
  submittingCode: boolean;
  submitCode: () => Promise<void>;
  cancelCodeEntry: () => void;
};

export type OpenAIAuthHandle = ProviderAuthHandle & {
  providerId: "openai-codex";
  attemptId: string | null;
  verificationUrl: string | null;
  userCode: string | null;
};

export type ProviderAuthHandleUnion = ClaudeAuthHandle | OpenAIAuthHandle;

interface UseProviderAuthOptions {
  sessionId?: string;
}

/**
 * Unified hook that returns auth handles for all providers.
 * Each handle exposes connect/disconnect and provider-specific flow state.
 */
export function useProviderAuth({ sessionId }: UseProviderAuthOptions = {}) {
  const claude = useClaudeAuth({ sessionId });
  const openai = useOpenAIAuth();

  const claudeHandle: ClaudeAuthHandle = useMemo(() => ({
    providerId: "claude-code" as const,
    connected: claude.connected,
    requiresReauth: claude.requiresReauth,
    loading: claude.loading,
    error: claude.error,
    connect: claude.connect,
    disconnect: claude.disconnect,
    awaitingCode: claude.awaitingCode,
    code: claude.code,
    setCode: claude.setCode,
    submittingCode: claude.submittingCode,
    submitCode: claude.submitCode,
    cancelCodeEntry: claude.cancelCodeEntry,
  }), [
    claude.awaitingCode,
    claude.cancelCodeEntry,
    claude.code,
    claude.connect,
    claude.connected,
    claude.disconnect,
    claude.error,
    claude.loading,
    claude.requiresReauth,
    claude.setCode,
    claude.submitCode,
    claude.submittingCode,
  ]);

  const openaiHandle: OpenAIAuthHandle = useMemo(() => ({
    providerId: "openai-codex" as const,
    connected: openai.connected,
    requiresReauth: openai.requiresReauth,
    loading: openai.loading,
    error: openai.error,
    connect: openai.connect,
    disconnect: openai.disconnect,
    attemptId: openai.attemptId,
    verificationUrl: openai.verificationUrl,
    userCode: openai.userCode,
  }), [
    openai.attemptId,
    openai.connect,
    openai.connected,
    openai.disconnect,
    openai.error,
    openai.loading,
    openai.requiresReauth,
    openai.userCode,
    openai.verificationUrl,
  ]);

  const handles: ProviderAuthHandleUnion[] = useMemo(
    () => [claudeHandle, openaiHandle],
    [claudeHandle, openaiHandle],
  );

  const getHandle = useCallback(
    (providerId: ProviderId): ProviderAuthHandleUnion => {
      switch (providerId) {
        case "claude-code":
          return claudeHandle;
        case "openai-codex":
          return openaiHandle;
        default: {
          const exhaustiveCheck: never = providerId;
          throw new Error(`Unhandled provider: ${exhaustiveCheck}`);
        }
      }
    },
    [claudeHandle, openaiHandle],
  );

  const isAnyLoading = claude.loading || openai.loading;

  return { handles, getHandle, isAnyLoading, claudeHandle, openaiHandle };
}
