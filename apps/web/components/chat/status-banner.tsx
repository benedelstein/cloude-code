"use client";

import { AlertTriangle } from "lucide-react";
import type { SessionStatus } from "@repo/shared";
import { LoadingSpinner } from "@/components/parts/loading-spinner";

interface StatusBannerProps {
  sessionStatus: SessionStatus | null;
  errorMessage: string | null;
}

const statusMessages: Record<SessionStatus, string> = {
  provisioning: "Provisioning VM...",
  cloning: "Cloning repository...",
  syncing: "Syncing repository...",
  attaching: "Connecting to agent...",
  ready: "",
  error: "An error occurred",
  terminated: "Session terminated",
};

const statusColors: Record<SessionStatus, string> = {
  provisioning: "border-accent/30 bg-accent-subtle text-accent",
  cloning: "border-accent/30 bg-accent-subtle text-accent",
  syncing: "border-accent/30 bg-accent-subtle text-accent",
  attaching: "border-accent/30 bg-accent-subtle text-accent",
  ready: "",
  error: "border-danger/30 bg-danger/10 text-danger",
  terminated: "border-danger/30 bg-danger/10 text-danger",
};

const isVisible = (status: SessionStatus | null) => status !== null && status !== "ready";

export function StatusBanner({ sessionStatus, errorMessage }: StatusBannerProps) {
  const visible = isVisible(sessionStatus);

  const message = sessionStatus === "error" && errorMessage
    ? errorMessage
    : sessionStatus ? statusMessages[sessionStatus] : "";

  return (
    <div
      className="grid transition-all duration-300 ease-in-out"
      style={{
        gridTemplateRows: visible ? "1fr" : "0fr",
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="overflow-hidden">
        <div className={`mx-3 mt-3 rounded-md border px-3 py-2 flex items-center gap-2.5 ${visible && sessionStatus ? statusColors[sessionStatus] : ""}`}>
          {sessionStatus !== "error" && sessionStatus !== "terminated" && (
            <LoadingSpinner className="h-3.5 w-3.5" />
          )}
          {(sessionStatus === "error" || sessionStatus === "terminated") && (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          <span className="text-xs font-medium">{message}</span>
        </div>
      </div>
    </div>
  );
}
