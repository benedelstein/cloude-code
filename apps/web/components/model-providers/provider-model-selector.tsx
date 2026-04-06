"use client";

import { Check, ChevronsUpDown, Link2 } from "lucide-react";
import { useState } from "react";
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
  CommandGroup,
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
  // eslint-disable-next-line no-unused-vars
  onSelect: (providerId: ProviderId, modelId: string) => void;
  // eslint-disable-next-line no-unused-vars
  onConnect: (providerId: ProviderId) => void;
  disabled?: boolean;
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
}: ProviderModelSelectorProps) {
  const [open, setOpen] = useState(false);

  const hasSelection = selectedProvider !== null && selectedModel !== null;
  const displayLabel = hasSelection
    ? getDisplayLabel(selectedProvider, selectedModel)
    : "Select a model";
  const providers = allowedProviderIds
    ? PROVIDER_LIST.filter((provider) => allowedProviderIds.includes(provider.id))
    : PROVIDER_LIST;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className="flex items-center gap-1.5 px-2.5 h-7 text-xs font-medium rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-default cursor-pointer"
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
          <span className={cn("truncate", !hasSelection && "text-foreground-muted text-bold")}>
            {displayLabel}
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="end">
        <Command>
          <CommandList>
            {providers.map((provider, index) => {
              const handle = providerAuthHandles.find(
                (h) => h.providerId === provider.id,
              );
              const isConnected = handle?.connected ?? false;

              return (
                <div key={provider.id}>
                  {index > 0 && <CommandSeparator />}
                  <CommandGroup
                    heading={
                      <span className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-semibold">
                          <Image
                            src={PROVIDER_ICONS[provider.id].src}
                            alt={PROVIDER_ICONS[provider.id].alt}
                            width={12}
                            height={12}
                            className="h-3 w-3"
                          />
                          {provider.displayName}
                        </span>
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
                    {provider.models.map((model) => {
                      const isSelected =
                        selectedProvider === provider.id &&
                        selectedModel === model.id;
                      return (
                        <CommandItem
                          key={`${provider.id}:${model.id}`}
                          value={`${provider.id}:${model.id}`}
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
