"use client";

import { useCallback, useEffect, useState } from "react";
import { getCurrentUser, type UserInfo, ApiError } from "@/lib/api";

export function useAuth() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setUser(null);
        } else {
          console.error("Failed to fetch user:", err);
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async () => {
    setAuthError(null);

    // Fetch the OAuth URL from the API (proxied through catch-all)
    const res = await fetch("/api/auth/github");
    if (!res.ok) {
      console.error("Failed to get auth URL");
      setAuthError("Failed to start GitHub sign-in.");
      return;
    }
    const { url } = await res.json();

    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      "github-auth",
      `width=${width},height=${height},left=${left},top=${top}`,
    );

    if (!popup) {
      setAuthError("GitHub sign-in popup was blocked.");
      return;
    }

    // Listen for the popup to signal auth completion
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "auth:success") {
        setAuthError(null);
        setUser(event.data.user);
        setLoading(false);
        window.removeEventListener("message", handleMessage);

        // Redirect to GitHub App install page if no installations yet
        if (event.data.hasInstallations === false && event.data.installUrl) {
          window.location.href = event.data.installUrl;
        }
      } else if (event.data?.type === "auth:error") {
        setAuthError(
          typeof event.data.error === "string" && event.data.error.length > 0
            ? event.data.error
            : "GitHub sign-in failed.",
        );
        setLoading(false);
        window.removeEventListener("message", handleMessage);
      }
    };
    window.addEventListener("message", handleMessage);

    // Fallback: if popup is closed without completing, check auth status
    const interval = setInterval(() => {
      if (popup?.closed) {
        clearInterval(interval);
        window.removeEventListener("message", handleMessage);
        getCurrentUser()
          .then(setUser)
          .catch(() => setUser(null))
          .finally(() => setLoading(false));
      }
    }, 500);
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    window.location.href = "/login";
  }, []);

  return {
    user,
    loading,
    authError,
    isAuthenticated: !!user,
    login,
    logout,
  };
}
