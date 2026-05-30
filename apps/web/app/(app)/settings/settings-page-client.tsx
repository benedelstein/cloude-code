"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowUpRight, ChevronRight, Github, LogOut, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { PROVIDER_LIST, type ProviderId } from "@repo/shared";
import { Button } from "@/components/ui/button";
import { ProviderSigninPanel } from "@/components/model-providers/provider-signin-panel";
import { useAuth } from "@/hooks/use-auth";
import { useProviderAuth, type ProviderAuthHandleUnion } from "@/hooks/use-provider-auth";
import { listRepos } from "@/lib/client-api";
import { SettingsPageHeader, SettingsShell } from "./settings-shell";

const PROVIDER_ICONS: Record<ProviderId, { src: string; alt: string }> = {
  "claude-code": { src: "/claude_logo.svg", alt: "Claude" },
  "openai-codex": { src: "/openai_logo.svg", alt: "OpenAI" },
};

const SETTINGS_ICON_CLASSNAME = "h-4 w-4";

export function SettingsPageClient() {
  const { user, logout } = useAuth();
  const providerAuth = useProviderAuth();
  const [signinPanelProvider, setSigninPanelProvider] = useState<ProviderId>("claude-code");
  const [showSigninPanel, setShowSigninPanel] = useState(false);
  const [disconnectingProvider, setDisconnectingProvider] = useState<ProviderId | null>(null);
  const [githubInstallUrl, setGithubInstallUrl] = useState<string | null>(null);
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

  useEffect(() => {
    let stale = false;

    (async () => {
      try {
        const response = await listRepos({ limit: 1 });
        if (!stale) {
          setGithubInstallUrl(response.installUrl);
        }
      } catch {
        if (!stale) {
          setGithubInstallUrl(null);
        }
      }
    })();

    return () => {
      stale = true;
    };
  }, []);

  return (
    <SettingsShell>
      <div className="flex w-full flex-col gap-8">
        <div className="flex flex-col gap-4">
          <SettingsPageHeader title="Settings" />
          {/* <section className="rounded-2xl border border-border bg-background p-5">
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
                    <p className="truncate text-sm text-foreground-secondary">
                      {user?.login ? `@${user.login}` : "Signed in"}
                    </p>
                  </>
                )}
              </div>
            </div>
          </section> */}
        </div>

        <SettingsSection
          title="Source control"
          description="Repository access and installation status."
        >
          <SettingsItemRow
            icon={<Github className={SETTINGS_ICON_CLASSNAME} />}
            title="GitHub"
            titleMeta={<StatusPill tone="success">Connected</StatusPill>}
            description={
              user?.login
                ? `Connected as ${user.login}`
                : "Connected to your GitHub account"
            }
            action={githubInstallUrl
              ? (
                <Button asChild variant="outline" size="sm" className="w-full shadow-none md:w-auto">
                  <Link href={githubInstallUrl} target="_blank" rel="noopener noreferrer">
                    Update settings
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              )
              : undefined}
          />
        </SettingsSection>

        <SettingsSection
          title="Session setup"
          description="Reusable configuration for starting sessions."
        >
          <SettingsLinkRow
            icon={<SlidersHorizontal className={SETTINGS_ICON_CLASSNAME} />}
            title="Environments"
            description="Manage repo-specific startup scripts and network access."
            href="/settings/environments"
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
          description="Manage model-provider authorization."
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

        <SettingsSection
          title="Other"
        >
          <SettingsItemRow
            icon={<LogOut className={SETTINGS_ICON_CLASSNAME} />}
            title="Sign out"
            action={(
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-center shadow-none md:w-auto"
                onClick={() => void logout()}
              >
                Sign out
              </Button>
            )}
          />
        </SettingsSection>
      </div>
    </SettingsShell>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description && <p className="text-sm text-foreground-secondary">{description}</p>}
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
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <SettingsItemRow
      icon={icon}
      title={title}
      description={description}
      href={href}
    />
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
    <SettingsItemRow
      icon={
        <Image
          src={icon.src}
          alt={icon.alt}
          width={16}
          height={16}
          className="h-4 w-4"
        />
      }
      title={provider.displayName}
      titleMeta={
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
          {handle.error && (
            <span className="text-xs text-danger">{handle.error}</span>
          )}
        </div>
      }
      action={
        <div className="flex flex-row gap-2">
          <Button
            type="button"
            variant={connected ? "destructiveOutline" : "default"}
            size="sm"
            className="w-full shadow-none md:w-auto"
            disabled={handle.loading || disconnecting}
            onClick={connected ? onDisconnect : onConnect}
          >
            {buttonLabel}
          </Button>
        </div>
      }
    />
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
      : "bg-muted text-foreground-secondary";

  return (
    <span className={`w-fit rounded-full px-2.5 py-[3px] text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function SettingsItemRow({
  icon,
  title,
  titleMeta,
  description,
  details,
  action,
  href,
}: {
  icon: ReactNode;
  title: string;
  titleMeta?: ReactNode;
  description?: string;
  details?: ReactNode;
  action?: ReactNode;
  href?: string;
}) {
  const className = "flex flex-col gap-4 border-b border-border px-4 py-3 min-h-[56px] last:border-b-0 md:flex-row md:items-center md:justify-between";
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground-secondary">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
            {titleMeta}
          </div>
          {details ?? (
            <p className="truncate text-sm text-foreground-secondary">{description}</p>
          )}
        </div>
      </div>
      <div className="flex flex-row items-center">
        {action}
        {href && (
          <span className="ml-0 flex w-0 overflow-hidden opacity-0 transition-[margin,width,opacity] duration-150 group-hover:ml-2 group-hover:w-4 group-hover:opacity-100">
            <ChevronRight className="h-4 w-4 shrink-0" />
          </span>
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`${className} group transition-colors hover:bg-muted/50`}
      >
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
