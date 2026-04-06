"use client";

import Image from "next/image";
import type { ComponentType, ComponentProps } from "react";
import type { ProviderId } from "@repo/shared";
import type {
  ProviderAuthHandleUnion,
} from "@/hooks/use-provider-auth";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <div className="rounded-lg border border-border bg-background p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Image
              src={meta.icon}
              alt={`${meta.name} logo`}
              width={16}
              height={16}
              className="h-4 w-4"
            />
            <DialogTitle className="text-sm font-semibold leading-none tracking-normal text-foreground">
              {handle.requiresReauth ? `Reconnect ${meta.name}` : `Connect ${meta.name}`}
            </DialogTitle>
          </div>

          <FlowComponent handle={handle} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
