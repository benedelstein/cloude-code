"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getClaudeAuthUrl,
  getClaudeStatus,
  disconnectClaude,
  exchangeClaudeCode,
} from "@/lib/api";

export function useClaudeAuth() {
  const [connected, setConnected] = useState(false);
  const [subscriptionType, setSubscriptionType] = useState<string | null>(null);
  const [rateLimitTier, setRateLimitTier] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [pendingState, setPendingState] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const status = await getClaudeStatus();
    setConnected(status.connected);
    setSubscriptionType(status.subscriptionType);
    setRateLimitTier(status.rateLimitTier);
  }, []);

  useEffect(() => {
    refreshStatus()
      .catch(() => {
        setConnected(false);
        setSubscriptionType(null);
        setRateLimitTier(null);
      })
      .finally(() => setLoading(false));
  }, [refreshStatus]);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const { url, state } = await getClaudeAuthUrl();
      setPendingState(state);
      setAwaitingCode(true);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (connectError) {
      const message = connectError instanceof Error
        ? connectError.message
        : "Failed to start Claude auth flow";
      setError(message);
      setAwaitingCode(false);
      setPendingState(null);
    }
  }, []);

  const submitCode = useCallback(async () => {
    if (!pendingState || !code.trim()) return;
    setSubmittingCode(true);
    setError(null);
    try {
      await exchangeClaudeCode(code.trim(), pendingState);
      await refreshStatus();
      setAwaitingCode(false);
      setPendingState(null);
      setCode("");
    } catch (exchangeError) {
      const message = exchangeError instanceof Error
        ? exchangeError.message
        : "Failed to exchange code";
      setError(message);
    } finally {
      setSubmittingCode(false);
    }
  }, [code, pendingState, refreshStatus]);

  const cancelCodeEntry = useCallback(() => {
    setAwaitingCode(false);
    setPendingState(null);
    setCode("");
    setError(null);
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectClaude();
    setConnected(false);
    setSubscriptionType(null);
    setRateLimitTier(null);
    setAwaitingCode(false);
    setPendingState(null);
    setCode("");
    setError(null);
  }, []);

  return {
    connected,
    subscriptionType,
    rateLimitTier,
    loading,
    awaitingCode,
    code,
    setCode,
    submittingCode,
    error,
    connect,
    submitCode,
    cancelCodeEntry,
    disconnect,
  };
}
