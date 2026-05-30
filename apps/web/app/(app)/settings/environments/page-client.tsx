"use client";

import Link from "next/link";
import { ArrowUpRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  deleteRepoEnvironment,
  listUserRepoEnvironments,
} from "@/lib/client-api";
import type { RepoEnvironmentSummary } from "@repo/shared";
import { SettingsPageHeader, SettingsShell } from "../settings-shell";

const ENVIRONMENT_TABLE_GRID_CLASS = "md:grid-cols-[minmax(7rem,1fr)_minmax(9rem,1.4fr)_minmax(5.5rem,0.7fr)_minmax(6rem,0.8fr)_auto]";
const CREATED_AT_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function formatCreatedAt(createdAt: string): string {
  return CREATED_AT_FORMATTER.format(new Date(createdAt));
}

export function EnvironmentsPageClient() {
  const [environments, setEnvironments] = useState<RepoEnvironmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteDialogEnvironment, setDeleteDialogEnvironment] =
    useState<RepoEnvironmentSummary | null>(null);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    (async () => {
      try {
        const data = await listUserRepoEnvironments();
        if (!stale) {
          setEnvironments(data.environments);
        }
      } catch (error) {
        if (!stale) {
          toast.error("Failed to load environments", {
            description: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } finally {
        if (!stale) {
          setLoading(false);
        }
      }
    })();

    return () => {
      stale = true;
    };
  }, []);

  const filteredEnvironments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return environments;
    }
    return environments.filter((environment) =>
      environment.name.toLowerCase().includes(normalizedQuery)
      || environment.repoFullName.toLowerCase().includes(normalizedQuery),
    );
  }, [environments, query]);

  async function handleDelete(environment: RepoEnvironmentSummary): Promise<void> {
    setDeletingId(environment.id);
    try {
      await deleteRepoEnvironment(environment.repoId, environment.id);
      setEnvironments((current) =>
        current.filter((item) => item.id !== environment.id),
      );
      toast.success("Environment deleted");
    } catch (error) {
      toast.error("Failed to delete environment", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <SettingsShell>
      <div className="flex flex-col gap-6">
        <SettingsPageHeader
          title="Environments"
          description="Repo-specific setup profiles for new agent sessions."
        />

        <div className="flex w-full items-center justify-between gap-3">
          <div className="relative min-w-0 max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-secondary" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search environments"
              className="pl-9 shadow-none"
            />
          </div>
          <Button asChild className="h-9 w-9 shrink-0 px-0 shadow-none min-[560px]:w-auto min-[560px]:px-4">
            <Link href="/settings/environments/create">
              <Plus className="h-4 w-4" />
              <span className="sr-only">Create environment</span>
              <span aria-hidden="true" className="hidden min-[560px]:inline">
                Create environment
              </span>
            </Link>
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <div className={`hidden ${ENVIRONMENT_TABLE_GRID_CLASS} gap-3 border-b border-border px-4 py-2 text-left text-xs font-medium uppercase text-foreground-secondary md:grid`}>
            <div className="min-w-0 justify-self-start text-left">Name</div>
            <div className="min-w-0 justify-self-start text-left">Repo</div>
            <div className="min-w-0 justify-self-start text-left">Network</div>
            <div className="min-w-0 justify-self-start text-left">Created at</div>
            <div className="min-w-0 justify-self-start text-left">Actions</div>
          </div>

          {loading ? (
            <EnvironmentListSkeleton />
          ) : filteredEnvironments.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <h3 className="text-sm font-medium text-foreground">
                {query.trim() ? "No matching environments" : "No environments yet"}
              </h3>
              <p className="mt-1 text-sm text-foreground-secondary">
                Create an environment when a repo needs custom setup.
              </p>
            </div>
          ) : (
            filteredEnvironments.map((environment) => (
              <EnvironmentRow
                key={environment.id}
                environment={environment}
                deleting={deletingId === environment.id}
                onDelete={() => setDeleteDialogEnvironment(environment)}
              />
            ))
          )}
        </div>

        <AlertDialog
          open={deleteDialogEnvironment !== null}
          onOpenChange={(open) => {
            if (!open) { setDeleteDialogEnvironment(null); }
          }}
        >
          <AlertDialogContent container={typeof document !== "undefined" ? document.body : undefined}>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete environment?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes "{deleteDialogEnvironment?.name ?? "this environment"}" from future session setup. Existing sessions using this environment will retain their environment settings.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteDialogEnvironment ? deletingId === deleteDialogEnvironment.id : false}
                onClick={() => {
                  if (deleteDialogEnvironment) {
                    void handleDelete(deleteDialogEnvironment);
                  }
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SettingsShell>
  );
}

function RepoLink({
  repoFullName,
  className,
}: {
  repoFullName: string;
  className?: string;
}) {
  return (
    <a
      href={`https://github.com/${repoFullName}`}
      target="_blank"
      rel="noreferrer"
      className={`group/repo inline-flex min-w-0 max-w-full items-center gap-1 text-foreground-secondary transition-colors hover:text-foreground ${className ?? ""}`}
    >
      <span className="truncate group-hover/repo:underline">{repoFullName}</span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/repo:opacity-100" />
    </a>
  );
}

function EnvironmentListSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2.5 ${ENVIRONMENT_TABLE_GRID_CLASS}`}
        >
          <div className="min-w-0">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-2 h-4 w-44" />
            <Skeleton className="mt-3 h-4 w-36 md:hidden" />
          </div>
          <Skeleton className="h-7 w-16 md:order-5" />
          <Skeleton className="hidden h-5 w-44 md:block" />
          <Skeleton className="hidden h-5 w-20 md:block" />
          <Skeleton className="hidden h-5 w-24 md:block" />
        </div>
      ))}
    </div>
  );
}

function EnvironmentRow({
  environment,
  deleting,
  onDelete,
}: {
  environment: RepoEnvironmentSummary;
  deleting: boolean;
  onDelete: () => void;
}) {
  const networkLabel = environment.network.mode === "default"
    ? "Default"
    : environment.network.mode === "custom"
      ? "Custom"
      : environment.network.mode === "locked"
        ? "No access"
        : "Unrestricted";

  const createdAtLabel = formatCreatedAt(environment.createdAt);

  return (
    <div className="border-b border-border transition-colors hover:bg-muted/40 last:border-b-0">
      <div className="flex items-start justify-between gap-3 px-4 py-3 md:hidden">
        <EnvironmentSummary
          environment={environment}
          networkLabel={networkLabel}
          createdAtLabel={createdAtLabel}
        />
        <EnvironmentActions
          environment={environment}
          deleting={deleting}
          onDelete={onDelete}
        />
      </div>

      <div className={`hidden gap-3 px-4 py-2.5 md:grid md:items-center ${ENVIRONMENT_TABLE_GRID_CLASS}`}>
        <EnvironmentName environment={environment} />
        <RepoLink repoFullName={environment.repoFullName} className="justify-self-start text-sm" />
        <div className="min-w-0 justify-self-start truncate text-left text-sm text-foreground-secondary">
          {networkLabel}
        </div>
        <div className="min-w-0 justify-self-start truncate text-left text-sm text-foreground-secondary">
          {createdAtLabel}
        </div>
        <EnvironmentActions
          environment={environment}
          deleting={deleting}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

function EnvironmentSummary({
  environment,
  networkLabel,
  createdAtLabel,
}: {
  environment: RepoEnvironmentSummary;
  networkLabel: string;
  createdAtLabel: string;
}) {
  return (
    <div className="min-w-0">
      <EnvironmentName environment={environment} />
      <RepoLink repoFullName={environment.repoFullName} className="mt-1 text-xs" />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-secondary">
        <span>{networkLabel}</span>
        <span>{createdAtLabel}</span>
      </div>
    </div>
  );
}

function EnvironmentName({ environment }: { environment: RepoEnvironmentSummary }) {
  return (
    <Link
      href={`/settings/environments/${environment.id}`}
      className="block truncate text-sm font-medium text-foreground hover:underline"
    >
      {environment.name}
    </Link>
  );
}

function EnvironmentActions({
  environment,
  deleting,
  onDelete,
}: {
  environment: RepoEnvironmentSummary;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 justify-start gap-1">
      <Button asChild variant="ghost" size="icon" className="h-7 w-7 text-foreground-secondary shadow-none hover:bg-accent/10 hover:text-accent">
        <Link href={`/settings/environments/${environment.id}`} aria-label={`Edit ${environment.name}`}>
          <Pencil className="h-4 w-4" />
        </Link>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-foreground-secondary shadow-none hover:bg-danger/10 hover:text-danger"
        disabled={deleting}
        onClick={onDelete}
        aria-label={deleting ? `Deleting ${environment.name}` : `Delete ${environment.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
