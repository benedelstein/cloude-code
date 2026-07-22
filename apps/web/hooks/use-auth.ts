"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SIGN_IN_ERROR_PARAM,
  signInErrorMessage,
  signInStartUrl,
} from "@/lib/sign-in-navigation";
import {
  ApiError,
  AUTH_UNAUTHORIZED_EVENT,
  getCurrentUser,
  logoutUser,
  type UserInfo,
} from "@/lib/client-api";

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

  // Same-tab sign-in reports failures by returning to this origin with a
  // stable error code. Surface it once, then strip it so a refresh or a later
  // share of the URL doesn't replay the error.
  useEffect(() => {
    const url = new URL(window.location.href);
    const message = signInErrorMessage(url.searchParams.get(SIGN_IN_ERROR_PARAM));
    if (!message) {
      return;
    }

    setAuthError(message);
    url.searchParams.delete(SIGN_IN_ERROR_PARAM);
    window.history.replaceState(null, "", url.toString());
  }, []);

  // React to any /api/* call returning 401 (e.g. GitHub App revoked, session
  // deleted, refresh token expired). Clear local user state so the next
  // render shows the login surface instead of failing requests in a loop.
  // Cookie cleanup uses raw fetch instead of logoutUser/apiFetch so that
  // a 401 from /auth/logout itself can't re-trigger this handler — keeps
  // loop-safety independent of how /auth/logout is routed.
  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      void fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      }).catch(() => undefined);
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => {
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    };
  }, []);

  /**
   * Navigates the current tab to the BFF start route. No popup, opener, or
   * polling is involved, so popup blockers cannot break sign-in; the BFF
   * restores this page's path once the flow settles.
   */
  const login = useCallback(() => {
    setAuthError(null);
    setLoading(true);
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(signInStartUrl(returnTo));
  }, []);

  const logout = useCallback(async () => {
    await logoutUser();
    setUser(null);
    window.location.href = "/";
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
