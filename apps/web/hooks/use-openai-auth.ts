"use client";

import { useCallback, useEffect, useState } from "react";
import { getOpenAIAuthUrl, getOpenAIStatus, disconnectOpenAI } from "@/lib/api";

export function useOpenAIAuth() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOpenAIStatus()
      .then((res) => setConnected(res.connected))
      .catch(() => setConnected(false))
      .finally(() => setLoading(false));
  }, []);

  const connect = useCallback(async () => {
    const { url } = await getOpenAIAuthUrl();

    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      "openai-auth",
      `width=${width},height=${height},left=${left},top=${top}`,
    );

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "openai:success") {
        setConnected(true);
        window.removeEventListener("message", handleMessage);
      } else if (event.data?.type === "openai:error") {
        console.error("OpenAI auth failed:", event.data.error);
        window.removeEventListener("message", handleMessage);
      }
    };
    window.addEventListener("message", handleMessage);

    // Fallback: if popup is closed without completing, re-check status
    const interval = setInterval(() => {
      if (popup?.closed) {
        clearInterval(interval);
        window.removeEventListener("message", handleMessage);
        getOpenAIStatus()
          .then((res) => setConnected(res.connected))
          .catch(() => setConnected(false));
      }
    }, 500);
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectOpenAI();
    setConnected(false);
  }, []);

  return {
    connected,
    loading,
    connect,
    disconnect,
  };
}
