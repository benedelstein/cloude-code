"use client";

import { useCallback, useState } from "react";
import {
  GitHubAuthPopupMessage,
  githubAuthPopupMessageType,
} from "@/types/auth";
import { startGitHubReauth } from "@/lib/client-api";

const POPUP_NAME = "github-reauth";

function openCenteredPopup(url: string, name: string, width: number, height: number): Window | null {
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  return window.open(
    url,
    name,
    `width=${width},height=${height},left=${left},top=${top}`,
  );
}

export function useGitHubReauth() {
  const [isReauthing, setIsReauthing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reconnect = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsReauthing(true);

    const popup = openCenteredPopup("about:blank", POPUP_NAME, 500, 700);
    if (!popup) {
      setError("GitHub reconnect popup was blocked.");
      setIsReauthing(false);
      return false;
    }

    let authUrl: string;
    try {
      authUrl = (await startGitHubReauth()).url;
    } catch {
      popup.close();
      setError("Failed to start GitHub reconnect.");
      setIsReauthing(false);
      return false;
    }

    popup.location.href = authUrl;

    return new Promise((resolve) => {
      let settled = false;

      const finish = (ok: boolean, nextError: string | null = null) => {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener("message", handleMessage);
        clearInterval(interval);
        setError(nextError);
        setIsReauthing(false);
        resolve(ok);
      };

      const handleMessage = (event: MessageEvent<unknown>) => {
        if (event.origin !== window.location.origin) {
          return;
        }

        const parsedMessage = GitHubAuthPopupMessage.safeParse(event.data);
        if (!parsedMessage.success) {
          return;
        }

        const message = parsedMessage.data;
        switch (message.type) {
          case githubAuthPopupMessageType.githubReauthSuccess:
            finish(true);
            return;
          case githubAuthPopupMessageType.githubReauthError:
            finish(false, message.error || "GitHub reconnect failed.");
            return;
          default: {
            const exhaustiveCheck: never = message;
            return exhaustiveCheck;
          }
        }
      };

      window.addEventListener("message", handleMessage);

      const interval = setInterval(() => {
        if (popup.closed) {
          finish(false, "GitHub reconnect was cancelled.");
        }
      }, 500);
    });
  }, []);

  return { reconnect, isReauthing, error };
}
