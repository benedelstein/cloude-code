"use client";

import type { SessionStatus } from "@repo/shared";

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
  provisioning: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  cloning: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  syncing: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  attaching: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  waking: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  hibernating: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  ready: "",
  error: "bg-red-500/10 text-red-500 border-red-500/20",
  terminated: "bg-red-500/10 text-red-500 border-red-500/20",
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
          <LoadingSpinner />
        )}
        {sessionStatus === "error" && (
          <ErrorIcon />
        )}
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}
