"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GitHubAuthPopupMessage,
  githubAuthPopupMessageType,
} from "@/types/auth";
import {
  ApiError,
  getCurrentUser,
  getGitHubAuthUrl,
  logoutUser,
  type UserInfo,
} from "@/lib/client-api";

const OAUTH_POPUP_NAME = "github-auth";
const INSTALL_POPUP_NAME = "github-install";

function openCenteredPopup(
  url: string,
  name: string,
  width: number,
  height: number,
): Window | null {
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  return window.open(
    url,
    name,
    `width=${width},height=${height},left=${left},top=${top}`,
  );
}

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
    setLoading(true);

    // Open popup synchronously with user gesture to avoid Safari popup blocker.
    // Safari blocks window.open() calls that happen after an await.
    const popup = openCenteredPopup("about:blank", OAUTH_POPUP_NAME, 500, 700);

    if (!popup) {
      setAuthError("GitHub sign-in popup was blocked.");
      setLoading(false);
      return;
    }

    let url: string;
    try {
      const response = await getGitHubAuthUrl();
      url = response.url;
    } catch (error) {
      console.error("Failed to get auth URL", error);
      popup.close();
      setAuthError("Failed to start GitHub sign-in.");
      setLoading(false);
      return;
    }

    popup.location.href = url;

    let installPopup: Window | null = null;
    let authFinished = false;
    let finalized = false;

    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      clearInterval(interval);
      clearInterval(installInterval);
    };

    const finalizeLogin = async () => {
      if (finalized) {
        return;
      }

      finalized = true;

      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
        setAuthError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setUser(null);
        } else {
          console.error("Failed to fetch user:", err);
          setUser(null);
        }
      } finally {
        setLoading(false);
        cleanup();
      }
    };

    // Listen for the popup to signal auth completion
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;

      const parsedMessage = GitHubAuthPopupMessage.safeParse(event.data);
      if (!parsedMessage.success) {
        return;
      }

      const message = parsedMessage.data;

      switch (message.type) {
        case githubAuthPopupMessageType.authSuccess:
          authFinished = true;
          if (message.hasInstallations === false && message.installUrl) {
            installPopup = openCenteredPopup(
              message.installUrl,
              INSTALL_POPUP_NAME,
              920,
              780,
            );

            if (!installPopup) {
              setAuthError("GitHub installation popup was blocked.");
              void finalizeLogin();
            }

            return;
          }

          void finalizeLogin();
          return;

        case githubAuthPopupMessageType.installComplete:
          void finalizeLogin();
          return;

        case githubAuthPopupMessageType.authError:
          setAuthError(
            message.error.length > 0
              ? message.error
              : "GitHub sign-in failed.",
          );
          setLoading(false);
          cleanup();
          return;

        default: {
          const exhaustiveCheck: never = message;
          return exhaustiveCheck;
        }
      }
    };
    window.addEventListener("message", handleMessage);

    // Fallback: if popup is closed without completing, check auth status
    const interval = setInterval(() => {
      if (popup?.closed) {
        if (authFinished) {
          clearInterval(interval);
          return;
        }

        void finalizeLogin();
      }
    }, 500);

    const installInterval = setInterval(() => {
      if (installPopup?.closed) {
        void finalizeLogin();
      }
    }, 500);
  }, []);

  const logout = useCallback(async () => {
    await logoutUser();
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
