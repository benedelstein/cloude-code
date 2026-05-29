"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Github, LogOut, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { PROVIDER_LIST, type ProviderId } from "@repo/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProviderSigninPanel } from "@/components/model-providers/provider-signin-panel";
import { useAuth } from "@/hooks/use-auth";
import { useProviderAuth, type ProviderAuthHandleUnion } from "@/hooks/use-provider-auth";

const PROVIDER_ICONS: Record<ProviderId, { src: string; alt: string }> = {
  "claude-code": { src: "/claude_logo.svg", alt: "Claude" },
  "openai-codex": { src: "/openai_logo.svg", alt: "OpenAI" },
};

export function SettingsPageClient() {
  const { user, loading, logout } = useAuth();
  const providerAuth = useProviderAuth();
  const [signinPanelProvider, setSigninPanelProvider] = useState<ProviderId>("claude-code");
  const [showSigninPanel, setShowSigninPanel] = useState(false);
  const [disconnectingProvider, setDisconnectingProvider] = useState<ProviderId | null>(null);
  const displayName = user?.name || user?.login || "Your account";
  const signinPanelHandle = providerAuth.getHandle(signinPanelProvider);

  useEffect(() => {
    if (!showSigninPanel) {
      return;
    }

    if (
      signinPanelHandle.loading ||
      !signinPanelHandle.connected ||
      signinPanelHandle.requiresReauth
    ) {
      return;
    }

    setShowSigninPanel(false);
  }, [
    showSigninPanel,
    signinPanelHandle.connected,
    signinPanelHandle.loading,
    signinPanelHandle.requiresReauth,
  ]);

  const handleProviderConnect = (providerId: ProviderId) => {
    setSigninPanelProvider(providerId);
    setShowSigninPanel(true);
  };

  const handleProviderDisconnect = async (handle: ProviderAuthHandleUnion) => {
    setDisconnectingProvider(handle.providerId);
    try {
      await handle.disconnect();
      const provider = PROVIDER_LIST.find((item) => item.id === handle.providerId);
      toast.success(`${provider?.displayName ?? "Provider"} disconnected.`);
    } catch (error) {
      toast.error("Failed to disconnect provider", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setDisconnectingProvider(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-14 md:py-16">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <section className="rounded-2xl border border-border bg-background p-5">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              {loading ? (
                <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
              ) : user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.login}
                  className="h-14 w-14 shrink-0 rounded-full"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-lg font-semibold text-accent">
                  {displayName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                {loading ? (
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ) : (
                  <>
                    <h2 className="truncate text-lg font-semibold text-foreground">
                      {displayName}
                    </h2>
                    <p className="truncate text-sm text-foreground-muted">
                      {user?.login ? `@${user.login}` : "Signed in"}
                    </p>
                  </>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center shadow-none md:w-auto"
              onClick={() => void logout()}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </section>

        <SettingsSection
          title="Source control"
          description="Repository access and installation status."
        >
          <SettingsRow
            icon={<Github className="h-5 w-5" />}
            title="GitHub"
            description={
              user?.login
                ? `Connected as ${user.login}`
                : "Connected to your GitHub account"
            }
            actionLabel="Connected"
            tone="success"
          />
        </SettingsSection>

        <SettingsSection
          title="Session setup"
          description="Reusable configuration for starting sessions."
        >
          <SettingsLinkRow
            icon={<SlidersHorizontal className="h-5 w-5" />}
            title="Environments"
            description="Manage repo-specific startup scripts and network access."
            href="/settings/environments"
            actionLabel="Manage"
          />
        </SettingsSection>

        {!signinPanelHandle.loading && (
          <ProviderSigninPanel
            providerId={signinPanelProvider}
            handle={signinPanelHandle}
            open={showSigninPanel}
            onOpenChange={setShowSigninPanel}
          />
        )}

        <SettingsSection
          title="Provider connections"
          description="Manage model-provider authorization for session creation."
        >
          {PROVIDER_LIST.map((provider) => {
            const handle = providerAuth.getHandle(provider.id);
            return (
              <ProviderConnectionRow
                key={provider.id}
                handle={handle}
                disconnecting={disconnectingProvider === provider.id}
                onConnect={() => handleProviderConnect(provider.id)}
                onDisconnect={() => void handleProviderDisconnect(handle)}
              />
            );
          })}
        </SettingsSection>
      </main>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <p className="text-sm text-foreground-muted">{description}</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-background">
        {children}
      </div>
    </section>
  );
}

function SettingsLinkRow({
  icon,
  title,
  description,
  href,
  actionLabel,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-4 border-b border-border px-5 py-4 transition-colors last:border-b-0 hover:bg-muted/50 md:flex-row md:items-center md:justify-between"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground-muted">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
          <p className="truncate text-sm text-foreground-muted">{description}</p>
        </div>
      </div>
      <span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground-muted">
        {actionLabel}
      </span>
    </Link>
  );
}

function ProviderConnectionRow({
  handle,
  disconnecting,
  onConnect,
  onDisconnect,
}: {
  handle: ProviderAuthHandleUnion;
  disconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const provider = PROVIDER_LIST.find((item) => item.id === handle.providerId);
  if (!provider) {
    return null;
  }

  const icon = PROVIDER_ICONS[handle.providerId];
  const connected = handle.connected && !handle.requiresReauth;
  const statusLabel = handle.loading
    ? "Checking..."
    : connected
      ? "Connected"
      : handle.requiresReauth
        ? "Reconnect required"
        : "Not connected";
  const statusTone = connected
    ? "success"
    : handle.requiresReauth
      ? "warning"
      : "muted";
  const buttonLabel = connected
    ? disconnecting ? "Disconnecting..." : "Disconnect"
    : handle.requiresReauth ? "Reconnect" : "Connect";

  return (
    <div className="flex flex-col gap-4 border-b border-border px-5 py-4 last:border-b-0 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground-muted">
          <Image
            src={icon.src}
            alt={icon.alt}
            width={20}
            height={20}
            className="h-5 w-5"
          />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">
            {provider.displayName}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
            {handle.error && (
              <span className="text-xs text-danger">{handle.error}</span>
            )}
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant={connected ? "outline" : "default"}
        size="sm"
        className="w-full shadow-none md:w-auto"
        disabled={handle.loading || disconnecting}
        onClick={connected ? onDisconnect : onConnect}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "muted" | "success" | "warning";
  children: ReactNode;
}) {
  const className = tone === "success"
    ? "bg-edit-subtle text-edit"
    : tone === "warning"
      ? "bg-warning/10 text-warning"
      : "bg-muted text-foreground-muted";

  return (
    <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function SettingsRow({
  icon,
  title,
  description,
  actionLabel,
  tone = "muted",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  tone?: "muted" | "success";
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border px-5 py-4 last:border-b-0 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground-muted">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
          <p className="truncate text-sm text-foreground-muted">{description}</p>
        </div>
      </div>
      <span
        className={
          tone === "success"
            ? "w-fit rounded-full bg-edit-subtle px-2.5 py-1 text-xs font-medium text-edit"
            : "w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground-muted"
        }
      >
        {actionLabel}
      </span>
    </div>
  );
}
