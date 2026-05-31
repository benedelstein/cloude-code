"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  listRepos,
  searchRepos,
  type Repo,
} from "@/lib/client-api";
import { CACHE_KEY_REPOS, readCache, writeCache } from "@/lib/swr-cache";
import type { ListReposResponse } from "@repo/shared";

export function mergeRepos(existingRepos: Repo[], incomingRepos: Repo[]): Repo[] {
  const reposById = new Map<number, Repo>();

  for (const repo of existingRepos) {
    reposById.set(repo.id, repo);
  }

  for (const repo of incomingRepos) {
    reposById.set(repo.id, repo);
  }

  return Array.from(reposById.values());
}

export function useRepoPicker({
  requestedRepoId = null,
  requestedRepoFullName = null,
  useLastSelectedRepo = false,
  autoSelectSingleRepo = false,
  openOnMissingRequestedRepo = false,
}: {
  requestedRepoId?: number | null;
  requestedRepoFullName?: string | null;
  useLastSelectedRepo?: boolean;
  autoSelectSingleRepo?: boolean;
  openOnMissingRequestedRepo?: boolean;
} = {}) {
  const hasRequestedRepo =
    typeof requestedRepoId === "number"
    && Number.isFinite(requestedRepoId)
    && requestedRepoId > 0;

  const [repos, setRepos] = useState<Repo[]>([]);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Repo[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const reposRef = useRef<Repo[]>([]);

  useEffect(() => {
    reposRef.current = repos;
  }, [repos]);

  const findRequestedRepo = useMemo(() => {
    return (repoList: Repo[]): Repo | undefined => {
      if (!hasRequestedRepo) {
        return undefined;
      }
      return repoList.find((repo) =>
        repo.id === requestedRepoId || repo.fullName === requestedRepoFullName,
      );
    };
  }, [hasRequestedRepo, requestedRepoFullName, requestedRepoId]);

  function createRequestedRepoFallback(): Repo | null {
    if (!hasRequestedRepo || !requestedRepoFullName || requestedRepoId === null) {
      return null;
    }

    return {
      id: requestedRepoId,
      name: repoDisplayName(requestedRepoFullName),
      fullName: requestedRepoFullName,
      owner: requestedRepoFullName.split("/")[0] ?? "",
      private: false,
      description: null,
      defaultBranch: "",
    };
  }

  function includeRequestedRepo(repoList: Repo[]): Repo[] {
    const requestedRepoFallback = createRequestedRepoFallback();
    if (!requestedRepoFallback || findRequestedRepo(repoList)) {
      return repoList;
    }
    return mergeRepos([requestedRepoFallback], repoList);
  }

  function chooseSelectedRepo(params: {
    repoList: Repo[];
    currentSelected: Repo | null;
    cursor: string | null;
  }): Repo | null {
    const requestedRepo = findRequestedRepo(params.repoList);
    if (requestedRepo) {
      return requestedRepo;
    }

    if (params.currentSelected) {
      return params.repoList.find((repo) =>
        repo.id === params.currentSelected?.id,
      ) ?? params.currentSelected;
    }

    if (useLastSelectedRepo) {
      const lastRepoId = localStorage.getItem("lastRepoId");
      const lastRepo = lastRepoId
        ? params.repoList.find((repo) => repo.id === Number(lastRepoId))
        : undefined;
      if (lastRepo) {
        return lastRepo;
      }
    }

    if (autoSelectSingleRepo && params.repoList.length === 1 && !params.cursor) {
      return params.repoList[0] ?? null;
    }

    return null;
  }

  useEffect(() => {
    const cached = readCache<ListReposResponse>(CACHE_KEY_REPOS);
    if (cached) {
      const nextRepos = includeRequestedRepo(cached.data.repos);
      setRepos(nextRepos);
      setInstallUrl(cached.data.installUrl);
      setCursor(cached.data.cursor);
      setLoading(false);
      setSelectedRepo((currentSelected) =>
        chooseSelectedRepo({
          repoList: nextRepos,
          currentSelected,
          cursor: cached.data.cursor,
        }),
      );
    }

    let stale = false;
    void (async () => {
      try {
        const data = await listRepos();
        if (stale) { return; }
        writeCache(CACHE_KEY_REPOS, data);
        const nextRepos = includeRequestedRepo(data.repos);
        setRepos(nextRepos);
        setInstallUrl(data.installUrl);
        setCursor(data.cursor);
        setSelectedRepo((currentSelected) =>
          chooseSelectedRepo({
            repoList: nextRepos,
            currentSelected,
            cursor: data.cursor,
          }),
        );
      } catch (error) {
        if (!stale && !cached) {
          toast.error("Failed to fetch repositories", {
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
  }, [
    autoSelectSingleRepo,
    findRequestedRepo,
    hasRequestedRepo,
    requestedRepoFullName,
    requestedRepoId,
    useLastSelectedRepo,
  ]);

  useEffect(() => {
    if (!hasRequestedRepo || !requestedRepoFullName) {
      return;
    }
    if (selectedRepo?.id === requestedRepoId) {
      return;
    }

    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const data = await searchRepos(requestedRepoFullName, { limit: 10 });
        if (stale) { return; }
        const requestedRepo = findRequestedRepo(data.repos);
        if (!requestedRepo) {
          return;
        }
        setRepos((currentRepos) => mergeRepos(currentRepos, [requestedRepo]));
        setSelectedRepo(requestedRepo);
      } catch {
        if (!stale && openOnMissingRequestedRepo) {
          setSearchQuery(requestedRepoFullName);
          setOpen(true);
        }
      }
    }, 0);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [
    findRequestedRepo,
    hasRequestedRepo,
    openOnMissingRequestedRepo,
    requestedRepoFullName,
    requestedRepoId,
    selectedRepo?.id,
  ]);

  useEffect(() => {
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length === 0) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let stale = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await searchRepos(trimmedQuery);
        if (stale) { return; }
        setSearchResults(data.repos);
      } catch (error) {
        if (stale) { return; }
        toast.error("Repo search failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
        setSearchResults([]);
      } finally {
        if (!stale) { setSearching(false); }
      }
    }, 200);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!open && searchQuery !== "") {
      setSearchQuery("");
    }
  }, [open, searchQuery]);

  async function loadMore(): Promise<void> {
    if (!cursor || loadingMore) {
      return;
    }

    setLoadingMore(true);

    try {
      const data = await listRepos({ cursor });
      const nextRepos = mergeRepos(reposRef.current, data.repos);
      const nextData: ListReposResponse = {
        repos: nextRepos,
        installUrl: data.installUrl,
        cursor: data.cursor,
      };

      setRepos(nextRepos);
      setInstallUrl(data.installUrl);
      setCursor(data.cursor);
      writeCache(CACHE_KEY_REPOS, nextData);
      setSelectedRepo((currentSelected) => {
        if (!currentSelected) {
          return null;
        }

        return nextRepos.find((repo) => repo.id === currentSelected.id) ?? currentSelected;
      });
    } catch (error) {
      toast.error("Failed to load more repositories", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setLoadingMore(false);
    }
  }

  const isSearchMode = searchQuery.trim().length > 0;

  return {
    repos,
    visibleRepos: isSearchMode ? searchResults : repos,
    installUrl,
    loading,
    cursor,
    loadingMore,
    selectedRepo,
    setSelectedRepo,
    searchQuery,
    setSearchQuery,
    searching,
    isSearchMode,
    open,
    setOpen,
    loadMore,
  };
}

function repoDisplayName(repoFullName: string): string {
  return repoFullName.split("/").pop() ?? repoFullName;
}
