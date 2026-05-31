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
    void (async () => {
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
            <EnvironmentList
              environments={filteredEnvironments}
              deletingId={deletingId}
              onDelete={setDeleteDialogEnvironment}
            />
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
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[744px] table-fixed">
        <tbody className="divide-y divide-border">
          {Array.from({ length: 3 }).map((_, index) => (
            <tr key={index}>
              <td className="px-4 py-2.5"><Skeleton className="h-5 w-32" /></td>
              <td className="px-4 py-2.5"><Skeleton className="h-5 w-44" /></td>
              <td className="px-4 py-2.5"><Skeleton className="h-5 w-20" /></td>
              <td className="px-4 py-2.5"><Skeleton className="h-5 w-24" /></td>
              <td className="sticky right-0 bg-background px-3 py-2.5">
                <Skeleton className="h-7 w-16" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EnvironmentList({
  environments,
  deletingId,
  onDelete,
}: {
  environments: RepoEnvironmentSummary[];
  deletingId: string | null;
  onDelete: (environment: RepoEnvironmentSummary) => void;
}) {
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[744px] table-fixed">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[34%]" />
          <col className="w-[16%]" />
          <col className="w-[18%]" />
          <col className="w-24" />
        </colgroup>
        <thead className="border-b border-border text-left text-xs font-medium uppercase text-foreground-secondary">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Repo</th>
            <th className="px-4 py-2 font-medium">Network</th>
            <th className="px-4 py-2 font-medium">Created at</th>
            <th className="sticky right-0 z-20 bg-background px-3 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {environments.map((environment) => (
            <EnvironmentTableRow
              key={environment.id}
              environment={environment}
              deleting={deletingId === environment.id}
              onDelete={() => onDelete(environment)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EnvironmentTableRow({
  environment,
  deleting,
  onDelete,
}: {
  environment: RepoEnvironmentSummary;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <tr className="group transition-colors hover:bg-muted/40">
      <td className="min-w-0 px-4 py-2.5">
        <EnvironmentName environment={environment} />
      </td>
      <td className="min-w-0 px-4 py-2.5">
        <RepoLink repoFullName={environment.repoFullName} className="text-sm" />
      </td>
      <td className="truncate px-4 py-2.5 text-sm text-foreground-secondary">
        {getNetworkLabel(environment)}
      </td>
      <td className="truncate px-4 py-2.5 text-sm text-foreground-secondary">
        {formatCreatedAt(environment.createdAt)}
      </td>
      <td className="sticky right-0 z-10 bg-background px-3 py-2.5 group-hover:bg-muted/40">
        <EnvironmentActions
          environment={environment}
          deleting={deleting}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
}

function getNetworkLabel(environment: RepoEnvironmentSummary): string {
  switch (environment.network.mode) {
    case "default":
      return "Default";
    case "custom":
      return "Custom";
    case "locked":
      return "No access";
    case "open":
      return "Unrestricted";
  }
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
    <div className="flex shrink-0 justify-center gap-1">
      <Button asChild variant="ghost" size="icon" className="h-7 w-7 min-w-7 shrink-0 text-foreground-secondary shadow-none hover:bg-accent/10 hover:text-accent">
        <Link href={`/settings/environments/${environment.id}`} aria-label={`Edit ${environment.name}`}>
          <Pencil className="h-4 w-4" />
        </Link>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 min-w-7 shrink-0 text-foreground-secondary shadow-none hover:bg-danger/10 hover:text-danger"
        disabled={deleting}
        onClick={onDelete}
        aria-label={deleting ? `Deleting ${environment.name}` : `Delete ${environment.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
