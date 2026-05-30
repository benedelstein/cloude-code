"use client";

import { Check, ChevronDown, ChevronRight, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
  PROVIDERS,
  PROVIDER_LIST,
  type ProviderId,
} from "@repo/shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { ProviderAuthHandleUnion } from "@/hooks/use-provider-auth";

interface ProviderModelSelectorProps {
  selectedProvider: ProviderId | null;
  selectedModel: string | null;
  providerAuthHandles: ProviderAuthHandleUnion[];
  allowedProviderIds?: ProviderId[];
  onSelect: (providerId: ProviderId, modelId: string) => void;
  onConnect: (providerId: ProviderId) => void;
  disabled?: boolean;
  triggerClassName?: string;
  hideChevron?: boolean;
}

const PROVIDER_ICONS: Record<ProviderId, { src: string; alt: string }> = {
  "claude-code": { src: "/claude_logo.svg", alt: "Claude" },
  "openai-codex": { src: "/openai_logo.svg", alt: "OpenAI" },
};

function getDisplayLabel(providerId: ProviderId, modelId: string): string {
  const provider = PROVIDERS[providerId];
  const model = provider.models.find((m) => m.id === modelId);
  return model?.displayName ?? modelId;
}

export function ProviderModelSelector({
  selectedProvider,
  selectedModel,
  providerAuthHandles,
  allowedProviderIds,
  onSelect,
  onConnect,
  disabled,
  triggerClassName,
  hideChevron = false,
}: ProviderModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [collapsedProviderIds, setCollapsedProviderIds] = useState<Set<ProviderId>>(() => new Set());
  const selectedHandle = selectedProvider
    ? providerAuthHandles.find((handle) => handle.providerId === selectedProvider)
    : null;

  const hasSelection = selectedProvider !== null
    && selectedModel !== null
    && (selectedHandle?.connected ?? false);
  const displayLabel = hasSelection
    ? getDisplayLabel(selectedProvider, selectedModel)
    : "Select a model";
  const availableProviders = allowedProviderIds
    ? PROVIDER_LIST.filter((provider) => allowedProviderIds.includes(provider.id))
    : PROVIDER_LIST;
  const providers = selectedProvider
    ? [...availableProviders].sort((leftProvider, rightProvider) => {
      if (leftProvider.id === selectedProvider) { return -1; }
      if (rightProvider.id === selectedProvider) { return 1; }
      return 0;
    })
    : availableProviders;
  const isSearching = modelSearch.trim().length > 0;

  useEffect(() => {
    if (!open) {
      setModelSearch("");
      return;
    }

    setCollapsedProviderIds(new Set());
  }, [open]);

  const toggleProviderCollapsed = (providerId: ProviderId) => {
    setCollapsedProviderIds((current) => {
      const next = new Set(current);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-7 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50",
            triggerClassName,
          )}
        >
          {hasSelection && (
            <Image
              src={PROVIDER_ICONS[selectedProvider].src}
              alt={PROVIDER_ICONS[selectedProvider].alt}
              width={12}
              height={12}
              className="h-3 w-3 shrink-0"
            />
          )}
          <span className={cn("min-w-0 truncate", !hasSelection && "text-foreground-secondary text-bold")}>
            {displayLabel}
          </span>
          {!hideChevron && <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="end">
        <Command>
          <CommandInput
            placeholder="Search models..."
            value={modelSearch}
            onValueChange={setModelSearch}
          />
          <CommandList>
            {isSearching && <CommandEmpty>No matching models.</CommandEmpty>}
            {providers.map((provider, index) => {
              const handle = providerAuthHandles.find(
                (h) => h.providerId === provider.id,
              );
              const isConnected = handle?.connected ?? false;
              const isCollapsed = !isSearching && collapsedProviderIds.has(provider.id);

              return (
                <div key={provider.id}>
                  {index > 0 && <CommandSeparator />}
                  <CommandGroup
                    heading={
                      <span className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleProviderCollapsed(provider.id);
                          }}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left font-semibold transition-colors hover:bg-muted"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          )}
                          <Image
                            src={PROVIDER_ICONS[provider.id].src}
                            alt={PROVIDER_ICONS[provider.id].alt}
                            width={12}
                            height={12}
                            className="h-3 w-3"
                          />
                          <span className="min-w-0 truncate">{provider.displayName}</span>
                        </button>
                        {!isConnected && (
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              onConnect(provider.id);
                              setOpen(false);
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
                          >
                            <Link2 className="h-2.5 w-2.5" />
                            Connect
                          </button>
                        )}
                      </span>
                    }
                  >
                    {!isCollapsed && provider.models.map((model) => {
                      const isSelected =
                        selectedProvider === provider.id &&
                        selectedModel === model.id &&
                        isConnected;
                      return (
                        <CommandItem
                          key={`${provider.id}:${model.id}`}
                          value={`${provider.displayName} ${model.displayName}`}
                          disabled={!isConnected}
                          onSelect={() => {
                            if (isConnected) {
                              onSelect(provider.id, model.id);
                              setOpen(false);
                            }
                          }}
                          className={cn(!isConnected && "opacity-40")}
                        >
                          <Check
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              isSelected ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span>{model.displayName}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </div>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
