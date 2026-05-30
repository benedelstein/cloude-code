"use client";

import { ProviderEffortSelector } from "@/components/model-providers/provider-effort-selector";
import { ProviderModelSelector } from "@/components/model-providers/provider-model-selector";
import type { ProviderAuthHandleUnion } from "@/hooks/use-provider-auth";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@repo/shared";

interface ProviderModelEffortSelectorProps {
  selectedProvider: ProviderId | null;
  selectedModel: string | null;
  selectedEffort: string | null;
  providerAuthHandles: ProviderAuthHandleUnion[];
  onModelSelect: (providerId: ProviderId, modelId: string) => void;
  onEffortSelect: (providerId: ProviderId, effortId: string) => void;
  onConnect: (providerId: ProviderId) => void;
  allowedProviderIds?: ProviderId[];
  disabled?: boolean;
  className?: string;
}

export function ProviderModelEffortSelector({
  selectedProvider,
  selectedModel,
  selectedEffort,
  providerAuthHandles,
  onModelSelect,
  onEffortSelect,
  onConnect,
  allowedProviderIds,
  disabled,
  className,
}: ProviderModelEffortSelectorProps) {
  return (
    <div className={cn("flex min-w-0 max-w-[24rem] shrink items-center gap-0", className)}>
      <ProviderModelSelector
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        providerAuthHandles={providerAuthHandles}
        onSelect={onModelSelect}
        onConnect={onConnect}
        allowedProviderIds={allowedProviderIds}
        disabled={disabled}
        hideChevron
        triggerClassName="rounded-sm"
      />
      <ProviderEffortSelector
        selectedProvider={selectedProvider}
        selectedEffort={selectedEffort}
        onSelect={onEffortSelect}
        disabled={disabled || !selectedProvider}
        triggerClassName="rounded-sm"
      />
    </div>
  );
}
