"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageCircleWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { ApiError, claimIntegrationLink } from "@/lib/client-api";

type ClaimState =
  | { type: "idle" }
  | { type: "claiming" }
  | { type: "success"; expiresAt: string; externalUsername: string | null }
  | { type: "error"; message: string };

export function IntegrationLinkPageClient({ token }: { token: string | null }) {
  const { user, loading, login, authError } = useAuth();
  const [claimState, setClaimState] = useState<ClaimState>({ type: "idle" });

  useEffect(() => {
    if (!token || loading || !user || claimState.type !== "idle") {
      return;
    }

    setClaimState({ type: "claiming" });
    claimIntegrationLink(token)
      .then((response) => {
        setClaimState({
          type: "success",
          expiresAt: response.expiresAt,
          externalUsername: response.externalUsername,
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError
          ? error.message
          : "Failed to link integration. Request a fresh link from the integration.";
        setClaimState({ type: "error", message });
      });
  }, [claimState.type, loading, token, user]);

  const title = getTitle({ token, loading, user, claimState });
  const description = getDescription({ token, loading, user, claimState });

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <section className="flex w-full max-w-md flex-col items-center rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
        <StatusIcon token={token} loading={loading} user={user} claimState={claimState} />
        <h1 className="mt-5 text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-foreground-secondary">{description}</p>
        {authError && (
          <p className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
            {authError}
          </p>
        )}
        <div className="mt-6 flex flex-col items-center gap-3">
          {!loading && token && !user && (
            <Button type="button" onClick={() => void login()}>
              Sign in with GitHub
            </Button>
          )}
          {claimState.type === "error" && (
            <Button type="button" variant="outline" onClick={() => setClaimState({ type: "idle" })}>
              Try again
            </Button>
          )}
          {claimState.type === "success" && (
            <Button type="button" variant="outline" onClick={() => window.close()}>
              Return to integration
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}

function StatusIcon({
  token,
  loading,
  user,
  claimState,
}: {
  token: string | null;
  loading: boolean;
  user: unknown;
  claimState: ClaimState;
}) {
  if (!token || claimState.type === "error") {
    return <MessageCircleWarning className="h-12 w-12 text-warning" />;
  }
  if (loading || claimState.type === "claiming" || !user) {
    return <Loader2 className="h-12 w-12 animate-spin text-foreground-secondary" />;
  }
  return <CheckCircle2 className="h-12 w-12 text-edit" />;
}

function getTitle(params: {
  token: string | null;
  loading: boolean;
  user: unknown;
  claimState: ClaimState;
}): string {
  if (!params.token) {
    return "Invalid integration link";
  }
  if (params.claimState.type === "success") {
    return "Integration connected";
  }
  if (params.claimState.type === "error") {
    return "Link failed";
  }
  if (params.loading) {
    return "Checking your session";
  }
  if (!params.user) {
    return "Sign in to link integration";
  }
  return "Connecting integration";
}

function getDescription(params: {
  token: string | null;
  loading: boolean;
  user: unknown;
  claimState: ClaimState;
}): string {
  if (!params.token) {
    return "This link is missing a token. Request a fresh link from the integration.";
  }
  if (params.claimState.type === "success") {
    const expires = new Date(params.claimState.expiresAt).toLocaleDateString();
    const discordName = params.claimState.externalUsername
      ? ` Discord user ${params.claimState.externalUsername}`
      : " Your external account";
    return `${discordName} can create Cloude sessions until ${expires}.`;
  }
  if (params.claimState.type === "error") {
    return params.claimState.message;
  }
  if (params.loading) {
    return "One moment while we check whether you are signed in to Cloude.";
  }
  if (!params.user) {
    return "Sign in with GitHub, then this page will connect your external account to Cloude.";
  }
  return "One moment while we connect your Discord account.";
}
