"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  type GitHubInstallCompleteMessage,
  githubAuthPopupMessageType,
} from "@/types/auth";

export default function GithubInstallCompletePage() {
  const router = useRouter();

  useEffect(() => {
    if (window.opener && !window.opener.closed) {
      const message: GitHubInstallCompleteMessage = {
        type: githubAuthPopupMessageType.installComplete,
      };

      window.opener.postMessage(
        message,
        window.location.origin,
      );
      window.close();
      return;
    }

    router.replace("/");
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <p className="text-sm text-foreground-muted">Finishing GitHub setup...</p>
    </main>
  );
}
