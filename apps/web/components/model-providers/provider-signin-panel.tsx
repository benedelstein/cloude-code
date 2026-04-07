"use client";

import Image from "next/image";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ComponentProps,
} from "react";
import type { ProviderId } from "@repo/shared";
import { BackButton } from "@/components/parts/back-button";
import type {
  ProviderAuthHandleUnion,
  OpenAIAuthHandle,
} from "@/hooks/use-provider-auth";
import { CloseButton } from "@/components/parts/close-button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ProviderSigninPanelClaudeFlow } from "@/components/model-providers/provider-signin-panel-claude-flow";
import { ProviderSigninPanelOpenAIFlow } from "@/components/model-providers/provider-signin-panel-openai-flow";

type ProviderSigninPanelProps = {
  providerId: ProviderId;
  handle: ProviderAuthHandleUnion;
  open: boolean;
  onOpenChange: ComponentProps<typeof Dialog>["onOpenChange"];
};

type ProviderSigninMeta = {
  name: string;
  icon: string;
};

type ProviderSigninRenderer = {
  meta: ProviderSigninMeta;
  FlowComponent: ComponentType<{
    handle: ProviderAuthHandleUnion;
  }>;
};

const PROVIDER_SIGNIN_RENDERERS: Record<ProviderId, ProviderSigninRenderer> = {
  "claude-code": {
    meta: {
      name: "Claude",
      icon: "/claude_logo.svg",
    },
    FlowComponent: ProviderSigninPanelClaudeFlow as ComponentType<{
      handle: ProviderAuthHandleUnion;
    }>,
  },
  "openai-codex": {
    meta: {
      name: "OpenAI Codex",
      icon: "/openai_logo.svg",
    },
    FlowComponent: ProviderSigninPanelOpenAIFlow as ComponentType<{
      handle: ProviderAuthHandleUnion;
    }>,
  },
};

/**
 * Generic sign-in panel that renders provider-specific auth flow views.
 * Wraps both Claude (paste-code) and OpenAI Codex (device-code) flows
 * in a shared shell with consistent styling.
 */
export function ProviderSigninPanel({
  providerId,
  handle,
  open,
  onOpenChange,
}: ProviderSigninPanelProps) {
  const renderer = PROVIDER_SIGNIN_RENDERERS[providerId];
  const meta = renderer.meta;
  const FlowComponent = renderer.FlowComponent;
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const canGoBack = providerId === "openai-codex" && (handle as OpenAIAuthHandle).attemptId !== null;
  const contentStateKey = [
    providerId,
    handle.requiresReauth ? "reauth" : "connect",
    canGoBack ? "nested" : "root",
    "error" in handle && handle.error ? "error" : "ok",
    "awaitingCode" in handle && handle.awaitingCode ? "awaiting-code" : "default",
  ].join(":");

  useLayoutEffect(() => {
    if (!open) {
      setContentHeight(null);
      return;
    }

    const node = contentRef.current;
    if (!node) {
      return;
    }

    setContentHeight(node.scrollHeight);
  }, [contentStateKey, open, providerId]);

  useEffect(() => {
    if (!open) {
      setContentHeight(null);
      return;
    }

    const node = contentRef.current;
    if (!node) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      setContentHeight(node.scrollHeight);
    });

    resizeObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
    };
  }, [contentStateKey, open, providerId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md border-border border bg-background p-0 gap-0 overflow-hidden"
        showCloseButton={false}
        // onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-2">
            {canGoBack && (
              <BackButton
                onClick={() => (handle as OpenAIAuthHandle).reset()}
                className="cursor-pointer"
              />
            )}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Image
                src={meta.icon}
                alt={`${meta.name} logo`}
                width={16}
                height={16}
                className="h-4 w-4"
              />
              <DialogTitle className="text-base font-semibold leading-none tracking-normal text-foreground">
                {handle.requiresReauth ? `Reconnect ${meta.name}` : `Connect ${meta.name}`}
              </DialogTitle>
            </div>
            <DialogClose asChild>
              <CloseButton />
            </DialogClose>
          </div>

          <div
            className="overflow-hidden transition-[height] duration-200 ease-out"
            style={contentHeight === null ? undefined : { height: `${contentHeight}px` }}
          >
            <div key={contentStateKey} ref={contentRef}>
              <FlowComponent handle={handle} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
