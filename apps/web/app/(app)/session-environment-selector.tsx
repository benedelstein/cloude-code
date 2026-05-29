"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  listRepoEnvironments,
  type Repo,
} from "@/lib/client-api";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { RepoEnvironment } from "@repo/shared";

export function SessionEnvironmentSelector({
  selectedRepo,
  disabled,
  selectedEnvironmentId,
  onSelectEnvironment,
}: {
  selectedRepo: Repo | null;
  disabled: boolean;
  selectedEnvironmentId: string | null;
  onSelectEnvironment(environmentId: string | null): void;
}) {
  const [environments, setEnvironments] = useState<RepoEnvironment[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!selectedRepo) {
      setEnvironments([]);
      onSelectEnvironment(null);
      return;
    }

    let stale = false;
    setLoading(true);
    onSelectEnvironment(null);
    (async () => {
      try {
        const data = await listRepoEnvironments(selectedRepo.id);
        if (stale) { return; }
        setEnvironments(data.environments);
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
  }, [onSelectEnvironment, selectedRepo]);

  if (!selectedRepo) {
    return null;
  }

  const createHref = `/settings/environments/create?repoId=${selectedRepo.id}&repoFullName=${encodeURIComponent(selectedRepo.fullName)}`;
  const selectedEnvironment = environments.find((environment) =>
    environment.id === selectedEnvironmentId,
  ) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled || loading}>
        <button
          type="button"
          disabled={disabled || loading}
          className="flex h-8 max-w-[260px] cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50"
        >
          <span className="truncate">
            {loading
              ? "Loading environments..."
              : selectedEnvironment?.name ?? "Default environment"}
          </span>
          <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandList>
            {loading && (
              <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-foreground-secondary">
                <LoadingSpinner className="h-3.5 w-3.5" />
                <span>Loading environments...</span>
              </div>
            )}
            {!loading && environments.length === 0 && (
              <CommandEmpty>No environments for this repo.</CommandEmpty>
            )}
            <CommandGroup>
              <CommandItem
                value="default"
                onSelect={() => {
                  onSelectEnvironment(null);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1 truncate">
                  Default environment
                </span>
                {selectedEnvironmentId === null && (
                  <Check className="ml-auto h-3.5 w-3.5 shrink-0" />
                )}
              </CommandItem>
              {environments.map((environment) => (
                <CommandItem
                  key={environment.id}
                  value={environment.name}
                  onSelect={() => {
                    onSelectEnvironment(environment.id);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {environment.name}
                  </span>
                  {selectedEnvironmentId === environment.id && (
                    <Check className="ml-auto h-3.5 w-3.5 shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="border-t border-border p-1">
            <Link
              href={createHref}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Create environment
            </Link>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
