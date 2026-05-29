"use client";

import Link from "next/link";
import { ExternalLink, Pencil, Plus, Search, Trash2 } from "lucide-react";
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
import { SettingsShell } from "../settings-shell";

const ENVIRONMENT_TABLE_GRID_CLASS = "md:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_9rem_8rem_12rem]";

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
        <div className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Environments</h2>
            <p className="mt-1 text-sm text-foreground-muted">
              Repo-specific setup profiles for new agent sessions.
            </p>
          </div>
          <Button asChild className="w-full shadow-none md:w-auto">
            <Link href="/settings/environments/create">
              <Plus className="h-4 w-4" />
              Create environment
            </Link>
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search environments"
            className="pl-9 shadow-none"
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <div className={`hidden ${ENVIRONMENT_TABLE_GRID_CLASS} gap-3 border-b border-border px-4 py-3 text-xs font-medium uppercase text-foreground-muted md:grid`}>
            <div>Name</div>
            <div>Repo</div>
            <div>Network</div>
            <div>Startup</div>
            <div>Actions</div>
          </div>

          {loading ? (
            <EnvironmentListSkeleton />
          ) : filteredEnvironments.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <h3 className="text-sm font-medium text-foreground">
                {query.trim() ? "No matching environments" : "No environments yet"}
              </h3>
              <p className="mt-1 text-sm text-foreground-muted">
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
                This removes {deleteDialogEnvironment?.name ?? "this environment"} from future session setup. Existing sessions using this environment will retain their resolved network, environment variable, and startup settings.
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
      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/repo:opacity-100" />
    </a>
  );
}

function EnvironmentListSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className={`grid gap-3 px-4 py-4 ${ENVIRONMENT_TABLE_GRID_CLASS}`}
        >
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-14" />
          <Skeleton className="ml-auto h-8 w-20" />
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

  return (
    <div className={`grid gap-3 border-b border-border px-4 py-4 last:border-b-0 md:items-center ${ENVIRONMENT_TABLE_GRID_CLASS}`}>
      <div className="min-w-0">
        <Link
          href={`/settings/environments/${environment.id}`}
          className="block truncate text-sm font-medium text-foreground hover:underline"
        >
          {environment.name}
        </Link>
        <RepoLink repoFullName={environment.repoFullName} className="mt-1 text-xs md:hidden" />
      </div>
      <RepoLink repoFullName={environment.repoFullName} className="hidden text-sm md:inline-flex" />
      <div className="text-sm text-foreground-secondary">{networkLabel}</div>
      <div className="text-sm text-foreground-secondary">
        {environment.startupScript ? "Yes" : "No"}
      </div>
      <div className="flex justify-start gap-1">
        <Button asChild variant="ghost" size="sm" className="text-foreground-secondary shadow-none hover:bg-accent/10 hover:text-accent">
          <Link href={`/settings/environments/${environment.id}`}>
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-foreground-secondary shadow-none hover:bg-danger/10 hover:text-danger"
          disabled={deleting}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? "Deleting" : "Delete"}
        </Button>
      </div>
    </div>
  );
}
