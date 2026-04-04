"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  startOpenAIDeviceAuthorization,
  pollOpenAIDeviceAuthorization,
  getOpenAIStatus,
  disconnectOpenAI,
} from "@/lib/client-api";

export function useOpenAIAuth() {
  const [connected, setConnected] = useState(false);
  const [requiresReauth, setRequiresReauth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);

  const clearPollTimeout = useCallback(() => {
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    getOpenAIStatus()
      .then((res) => {
        setConnected(res.connected);
        setRequiresReauth(res.requiresReauth);
      })
      .catch(() => {
        setConnected(false);
        setRequiresReauth(false);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      clearPollTimeout();
    };
  }, [clearPollTimeout]);

  const connect = useCallback(async () => {
    clearPollTimeout();
    setError(null);

    const result = await startOpenAIDeviceAuthorization();
    setAttemptId(result.attemptId);
    setVerificationUrl(result.verificationUrl);
    setUserCode(result.userCode);

    window.open(result.verificationUrl, "_blank", "noopener,noreferrer");

    const poll = async () => {
      try {
        const status = await pollOpenAIDeviceAuthorization(result.attemptId);
        if (status.status === "completed") {
          setConnected(true);
          setRequiresReauth(false);
          setAttemptId(null);
          return;
        }
        if (status.status === "expired") {
          setAttemptId(null);
          setError("OpenAI device authorization expired.");
          return;
        }
        pollTimeoutRef.current = window.setTimeout(poll, result.intervalSeconds * 1000);
      } catch (pollError) {
        setAttemptId(null);
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll OpenAI device authorization.",
        );
      }
    };

    pollTimeoutRef.current = window.setTimeout(poll, result.intervalSeconds * 1000);
  }, [clearPollTimeout]);

  const disconnect = useCallback(async () => {
    clearPollTimeout();
    await disconnectOpenAI();
    setConnected(false);
    setRequiresReauth(false);
    setAttemptId(null);
    setVerificationUrl(null);
    setUserCode(null);
    setError(null);
  }, [clearPollTimeout]);

  return {
    connected,
    requiresReauth,
    loading,
    attemptId,
    verificationUrl,
    userCode,
    error,
    connect,
    disconnect,
  };
}
