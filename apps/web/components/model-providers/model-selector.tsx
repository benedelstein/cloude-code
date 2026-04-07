"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { CLAUDE_MODEL_DISPLAY_NAMES, type ClaudeModel } from "@repo/shared";
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
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

const MODELS = Object.entries(CLAUDE_MODEL_DISPLAY_NAMES) as [ClaudeModel, string][];

interface ModelSelectorProps {
  selectedModel: ClaudeModel;
  // eslint-disable-next-line no-unused-vars
  onSelect: (model: ClaudeModel) => void;
  disabled?: boolean;
}

export function ModelSelector({ selectedModel, onSelect, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className="flex items-center gap-1.5 px-2.5 h-7 text-xs font-medium rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-default cursor-pointer"
        >
          <span className="truncate">
            {CLAUDE_MODEL_DISPLAY_NAMES[selectedModel]}
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="end">
        <Command>
          <CommandList>
            <CommandGroup>
              {MODELS.map(([id, label]) => (
                <CommandItem
                  key={id}
                  value={id}
                  onSelect={() => {
                    onSelect(id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      selectedModel === id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
