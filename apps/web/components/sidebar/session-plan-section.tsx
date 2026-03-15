"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { SessionPlanResponse } from "@repo/shared";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SessionSidebarCard,
  SessionSidebarSection,
} from "@/components/sidebar/session-sidebar-section";

interface SessionPlanSectionProps {
  plan: SessionPlanResponse | null;
  isLoading: boolean;
  errorMessage: string | null;
}

const COLLAPSED_PLAN_MAX_HEIGHT_CLASS = "max-h-[220px]";

export function SessionPlanSection({
  plan,
  isLoading,
  errorMessage,
}: SessionPlanSectionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const minHeight = "min-h-[200px]";

  if (errorMessage) {
    return (
      <SessionSidebarSection title="Plan">
        <SessionSidebarCard variant="empty" className={minHeight}>
          {errorMessage}
        </SessionSidebarCard>
      </SessionSidebarSection>
    );
  }

  if (!isLoading && !plan) {
    return (
      <SessionSidebarSection title="Plan">
        <SessionSidebarCard variant="empty" className={minHeight}>
          No plan for this session.
        </SessionSidebarCard>
      </SessionSidebarSection>
    );
  }

  return (
    <>
      <SessionSidebarSection title="Plan">
        <SessionSidebarCard className={cn(minHeight, "overflow-hidden p-0")}>
          {isLoading ? (
            <div className="flex items-center gap-2 p-3 text-sm text-foreground-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading plan...</span>
            </div>
          ) : plan ? (
            <div
              className={cn(
                "group/plan relative overflow-hidden p-3",
                COLLAPSED_PLAN_MAX_HEIGHT_CLASS,
              )}
            >
              <PlanMarkdown plan={plan.plan} variant="preview" />
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/72 opacity-0 backdrop-blur-[1px] transition-opacity duration-150 group-hover/plan:opacity-100 group-focus-within/plan:opacity-100">
                <button
                  type="button"
                  onClick={() => setIsDialogOpen(true)}
                  className="pointer-events-auto rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-background-secondary"
                >
                  View plan
                </button>
              </div>
            </div>
          ) : null}
        </SessionSidebarCard>
      </SessionSidebarSection>

      {plan ? (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="h-[90vh] max-h-[900px] w-[90vw] max-w-[1100px] gap-0 overflow-hidden p-0">
            <DialogHeader className="border-b border-border px-6 py-4 text-left">
              <DialogTitle>Plan</DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto px-6 py-5">
              <PlanMarkdown plan={plan.plan} variant="dialog" />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function PlanMarkdown({
  plan,
  variant,
}: {
  plan: string;
  variant: "preview" | "dialog";
}) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none text-foreground-muted",
        variant === "preview"
          ? "[&_h1]:mb-3 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:leading-6 [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:leading-6 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:leading-5 [&_ol]:my-3 [&_ol]:pl-5 [&_p]:my-2 [&_p]:text-[13px] [&_p]:leading-6 [&_ul]:my-3 [&_ul]:pl-5"
          : "[&_h1]:text-4xl [&_h1]:leading-tight [&_h2]:text-3xl [&_h2]:leading-tight [&_h3]:text-2xl",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match;

            if (isInline) {
              return (
                <code
                  className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <SyntaxHighlighter
                style={oneDark}
                language={match[1]}
                PreTag="div"
                customStyle={{
                  margin: 0,
                  borderRadius: "0.5rem",
                  fontSize: "0.875rem",
                }}
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {plan}
      </ReactMarkdown>
    </div>
  );
}
