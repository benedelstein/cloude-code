"use client";

import { useCallback, useEffect, useState } from "react";
import { getModels } from "@/lib/client-api";
import type { ModelsResponse, ProviderCatalogEntry, ProviderId } from "@repo/shared";

export function useModels() {
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data: ModelsResponse = await getModels();
      setProviders(data.providers);
    } catch {
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getProvider = useCallback(
    (providerId: ProviderId): ProviderCatalogEntry | undefined =>
      providers.find((p) => p.providerId === providerId),
    [providers],
  );

  const isProviderConnected = useCallback(
    (providerId: ProviderId): boolean =>
      providers.find((p) => p.providerId === providerId)?.connected ?? false,
    [providers],
  );

  return { providers, loading, refresh, getProvider, isProviderConnected };
}
