"use client";

import { AlertTriangle } from "lucide-react";
import type { SessionStatus } from "@repo/shared";
import { LoadingSpinner } from "@/components/parts/loading-spinner";

interface StatusBannerProps {
  sessionStatus: SessionStatus;
  errorMessage: string | null;
}

const statusMessages: Record<SessionStatus, string> = {
  provisioning: "Provisioning VM...",
  cloning: "Cloning repository...",
  syncing: "Syncing repository...",
  attaching: "Connecting to agent...",
  waking: "Waking up VM...",
  hibernating: "VM hibernating...",
  ready: "",
  error: "An error occurred",
  terminated: "Session terminated",
};

const statusColors: Record<SessionStatus, string> = {
  provisioning: "bg-accent-subtle text-accent border-accent/20",
  cloning: "bg-accent-subtle text-accent border-accent/20",
  syncing: "bg-accent-subtle text-accent border-accent/20",
  attaching: "bg-accent-subtle text-accent border-accent/20",
  waking: "bg-warning/10 text-warning border-warning/20",
  hibernating: "bg-warning/10 text-warning border-warning/20",
  ready: "",
  error: "bg-danger/10 text-danger border-danger/20",
  terminated: "bg-danger/10 text-danger border-danger/20",
};

export function StatusBanner({ sessionStatus, errorMessage }: StatusBannerProps) {
  // Don't show banner when ready
  if (sessionStatus === "ready") {
    return null;
  }

  const message = sessionStatus === "error" && errorMessage
    ? errorMessage
    : statusMessages[sessionStatus];

  return (
    <div className={`shrink-0 border-b ${statusColors[sessionStatus]}`}>
      <div className="max-w-4xl mx-auto px-4 py-2 flex items-center gap-3">
        {sessionStatus !== "error" && (
          <LoadingSpinner className="h-4 w-4" />
        )}
        {sessionStatus === "error" && (
          <AlertTriangle className="h-4 w-4" />
        )}
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
}
