"use client";

import { useRef } from "react";
import { ImagePlus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ImageAttachButtonProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function ImageAttachButton({ onFiles, disabled }: ImageAttachButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Add images</TooltipContent>
      </Tooltip>
    </>
  );
}
