"use client";

import Link from "next/link";
import { Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deleteRepoEnvironment,
  listUserRepoEnvironments,
} from "@/lib/client-api";
import type { RepoEnvironmentSummary } from "@repo/shared";
import { SettingsShell } from "../settings-shell";

export function EnvironmentsPageClient() {
  const [environments, setEnvironments] = useState<RepoEnvironmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
          <div className="hidden grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_9rem_8rem_9rem] border-b border-border px-4 py-3 text-xs font-medium uppercase text-foreground-muted md:grid">
            <div>Name</div>
            <div>Repo</div>
            <div>Network</div>
            <div>Startup</div>
            <div className="text-right">Actions</div>
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
                onDelete={() => void handleDelete(environment)}
              />
            ))
          )}
        </div>
      </div>
    </SettingsShell>
  );
}

function EnvironmentListSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_9rem_8rem_9rem]"
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
  const networkLabel = environment.network.mode === "default_plus_extras"
    ? "Default"
    : environment.network.mode === "locked"
      ? "Locked"
      : "Open";

  return (
    <div className="grid gap-3 border-b border-border px-4 py-4 last:border-b-0 md:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_9rem_8rem_9rem] md:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {environment.name}
        </div>
        <div className="mt-1 text-xs text-foreground-muted md:hidden">
          {environment.repoFullName}
        </div>
      </div>
      <div className="hidden min-w-0 truncate text-sm text-foreground-secondary md:block">
        {environment.repoFullName}
      </div>
      <div className="text-sm text-foreground-secondary">{networkLabel}</div>
      <div className="text-sm text-foreground-secondary">
        {environment.startupScript ? "Yes" : "No"}
      </div>
      <div className="flex justify-start md:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-foreground-secondary shadow-none hover:text-danger"
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
