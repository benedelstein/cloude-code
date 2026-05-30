"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown } from "lucide-react";
import type { Repo } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { GithubIcon } from "@/components/github-icon";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const LIST_SCROLL_PREFETCH_THRESHOLD = 96;

export function RepoSelector({
  repos,
  selectedRepo,
  onSelect,
  loading,
  disabled,
  installUrl,
  open,
  onOpenChange,
  hasMore,
  loadingMore,
  onLoadMore,
  searchQuery,
  onSearchQueryChange,
  searching,
  isSearchMode,
  triggerClassName,
}: {
  repos: Repo[];
  selectedRepo: Repo | null;
  onSelect: (repo: Repo) => void;
  loading: boolean;
  disabled: boolean;
  installUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searching: boolean;
  isSearchMode: boolean;
  triggerClassName?: string;
}) {
  const commandListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || isSearchMode || !hasMore || loadingMore) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      const commandList = commandListRef.current;
      if (!commandList) {
        return;
      }

      if (commandList.scrollHeight <= commandList.clientHeight + 1) {
        onLoadMore();
      }
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [hasMore, isSearchMode, loadingMore, onLoadMore, open, repos.length]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild disabled={loading || disabled}>
              <button
                type="button"
                disabled={loading || disabled}
                className={cn(
                  "flex h-8 max-w-[240px] min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50",
                  triggerClassName,
                )}
              >
                <GithubIcon className="h-3.5 w-3.5" />
                <span className="truncate">
                  {loading && !selectedRepo
                    ? "Loading repos..."
                    : selectedRepo
                      ? selectedRepo.fullName
                      : "Select a repo"}
                </span>
                <ChevronDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Select repository</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search repos..."
            value={searchQuery}
            onValueChange={onSearchQueryChange}
          />
          <CommandList
            ref={commandListRef}
            onScroll={(event) => {
              if (isSearchMode) {
                return;
              }
              const commandList = event.currentTarget;
              const hasReachedBottom =
                commandList.scrollTop + commandList.clientHeight >=
                commandList.scrollHeight - LIST_SCROLL_PREFETCH_THRESHOLD;

              if (hasReachedBottom && hasMore && !loadingMore) {
                onLoadMore();
              }
            }}
          >
            {!searching && repos.length === 0 && (
              <CommandEmpty>No repos found.</CommandEmpty>
            )}
            <CommandGroup>
              {searching && repos.length === 0 && (
                <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-foreground-secondary">
                  <LoadingSpinner className="h-3.5 w-3.5" />
                  <span>Searching...</span>
                </div>
              )}
              {repos.map((repo) => (
                <CommandItem
                  key={repo.id}
                  value={repo.fullName}
                  onSelect={() => {
                    onSelect(repo);
                    onOpenChange(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {repo.fullName}
                  </span>
                  {selectedRepo?.id === repo.id && (
                    <Check className="ml-auto h-3.5 w-3.5 shrink-0" />
                  )}
                </CommandItem>
              ))}
              {!isSearchMode && loadingMore && (
                <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-foreground-secondary">
                  <LoadingSpinner className="h-3.5 w-3.5" />
                  <span>Loading more repos...</span>
                </div>
              )}
            </CommandGroup>
          </CommandList>
          {installUrl && (
            <div className="border-t border-border p-1">
              <Link
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col items-start gap-1 rounded-sm px-2 py-1.5 text-xs text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground"
              >
                Don&apos;t see your repo?
                <div className="flex items-center gap-1 font-medium text-foreground group-hover:underline">
                  Configure access on GitHub
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
