"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/sign-in-navigation";

/**
 * Fallback for a GitHub App setup callback that arrives without installation
 * state — for example when the user installed from the repository picker's
 * external link. Repository availability is read from the repository API, so
 * there is nothing to finish here beyond returning to the app.
 */
export function GithubInstallCompletePageClient() {
  const router = useRouter();

  useEffect(() => {
    router.replace(DEFAULT_SIGNED_IN_PATH);
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <p className="text-sm text-foreground-secondary">Finishing GitHub setup...</p>
    </main>
  );
}
