"use client";

import { AlertTriangle } from "lucide-react";
import type { SessionStatus } from "@repo/shared";
import { LoadingSpinner } from "@/components/parts/loading-spinner";

interface StatusBannerProps {
  sessionStatus: SessionStatus | null;
  errorMessage: string | null;
}

const statusMessages: Record<SessionStatus, string> = {
  initializing: "Initializing session...",
  provisioning: "Provisioning VM...",
  cloning: "Cloning repository...",
  attaching: "Connecting to agent...",
  ready: "",
};

const statusColors: Record<SessionStatus, string> = {
  initializing: "border-accent/30 bg-accent-subtle text-accent",
  provisioning: "border-accent/30 bg-accent-subtle text-accent",
  cloning: "border-accent/30 bg-accent-subtle text-accent",
  attaching: "border-accent/30 bg-accent-subtle text-accent",
  ready: "",
};

const isVisible = (status: SessionStatus | null, errorMessage: string | null) =>
  errorMessage !== null || (status !== null && status !== "ready");

export function StatusBanner({ sessionStatus, errorMessage }: StatusBannerProps) {
  const visible = isVisible(sessionStatus, errorMessage);
  const isError = errorMessage !== null;

  const message = isError
    ? errorMessage
    : sessionStatus
      ? statusMessages[sessionStatus]
      : "";

  const colorClass = isError
    ? "border-danger/30 bg-danger/10 text-danger"
    : sessionStatus
      ? statusColors[sessionStatus]
      : "";

  return (
    <div
      className="grid transition-all duration-300 ease-in-out"
      style={{
        gridTemplateRows: visible ? "1fr" : "0fr",
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="overflow-hidden">
        <div className={`mx-3 mt-3 rounded-md border px-3 py-2 flex items-center gap-2.5 ${visible ? colorClass : ""}`}>
          {!isError && <LoadingSpinner className="h-3.5 w-3.5" />}
          {isError && <AlertTriangle className="h-3.5 w-3.5" />}
          <span className="text-xs font-medium">{message}</span>
        </div>
      </div>
    </div>
  );
}
