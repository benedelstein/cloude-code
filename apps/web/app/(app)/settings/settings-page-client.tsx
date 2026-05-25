"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import {
  ArrowUpRight,
  CreditCard,
  Github,
  LogOut,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";

const FUTURE_CONNECTIONS = [
  {
    name: "OpenAI Codex",
    description: "Model-provider connection status and token controls.",
    iconSrc: "/openai_logo.svg",
  },
  {
    name: "Claude Code",
    description: "Claude subscription, auth, and rate-limit details.",
    iconSrc: "/claude_logo.svg",
  },
];

export function SettingsPageClient() {
  const { user, loading, logout } = useAuth();
  const displayName = user?.name || user?.login || "Your account";

  return (
    <div className="h-full overflow-y-auto px-4 py-14 md:py-16">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground-muted">
            <Sparkles className="h-4 w-4" />
            Account settings
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Settings
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-foreground-muted">
              This space is ready for provider connections, billing, account
              controls, and workspace preferences as they come online.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-border bg-background p-5 shadow-shadow shadow-sm">
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
              className="w-full justify-center md:w-auto"
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
          title="Model providers"
          description="Provider connection management will live here soon."
        >
          {FUTURE_CONNECTIONS.map((connection) => (
            <SettingsRow
              key={connection.name}
              icon={
                <Image
                  src={connection.iconSrc}
                  alt={`${connection.name} logo`}
                  width={20}
                  height={20}
                  className="h-5 w-5"
                />
              }
              title={connection.name}
              description={connection.description}
              actionLabel="Coming soon"
            />
          ))}
        </SettingsSection>

        <div className="grid gap-4 md:grid-cols-2">
          <EmptyStateCard
            icon={<CreditCard className="h-5 w-5" />}
            title="Billing"
            description="Plan details, invoices, and payment methods will appear here."
          />
          <EmptyStateCard
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Account controls"
            description="Security, sessions, and workspace preferences are queued up next."
          />
        </div>
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
      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-shadow shadow-sm">
        {children}
      </div>
    </section>
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

function EmptyStateCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-background/70 p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground-muted">
        {icon}
      </div>
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-foreground-muted">
        {description}
      </p>
      <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-foreground-tertiary">
        Planned
        <ArrowUpRight className="h-3.5 w-3.5" />
      </div>
    </section>
  );
}
