"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { PROVIDERS, type ProviderId } from "@repo/shared";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ProviderEffortSelectorProps {
  selectedProvider: ProviderId | null;
  selectedEffort: string | null;
  onSelect: (providerId: ProviderId, effortId: string) => void;
  disabled?: boolean;
  triggerClassName?: string;
}

function getDisplayLabel(providerId: ProviderId, effortId: string): string {
  const provider = PROVIDERS[providerId];
  const effort = provider.efforts.find((item) => item.id === effortId);
  return effort?.displayName ?? effortId;
}

export function ProviderEffortSelector({
  selectedProvider,
  selectedEffort,
  onSelect,
  disabled,
  triggerClassName,
}: ProviderEffortSelectorProps) {
  const [open, setOpen] = useState(false);
  const hasSelection = selectedProvider !== null && selectedEffort !== null;
  const provider = selectedProvider ? PROVIDERS[selectedProvider] : null;
  const displayLabel = hasSelection
    ? getDisplayLabel(selectedProvider, selectedEffort)
    : "Reasoning";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled || !provider}>
        <button
          type="button"
          disabled={disabled || !provider}
          className={cn(
            "flex h-7 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50",
            triggerClassName,
          )}
        >
          <span
            className={cn(
              "min-w-0 truncate",
              !hasSelection && "text-foreground-secondary text-bold",
            )}
          >
            {displayLabel}
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="end">
        <Command>
          <CommandList>
            <CommandEmpty>No matching efforts.</CommandEmpty>
            {provider && (
              <CommandGroup heading="Reasoning">
                {provider.efforts.map((effort) => {
                  const isSelected = selectedEffort === effort.id;
                  return (
                    <CommandItem
                      key={`${provider.id}:${effort.id}`}
                      value={`${provider.displayName} ${effort.displayName}`}
                      onSelect={() => {
                        onSelect(provider.id, effort.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span>{effort.displayName}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
