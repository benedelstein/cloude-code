"use client";

import { AlertTriangle } from "lucide-react";

interface StatusBannerProps {
  sessionErrorMessage: string | null;
}

export function StatusBanner({ sessionErrorMessage }: StatusBannerProps) {
  const visible = sessionErrorMessage !== null;

  return (
    <div
      className="grid transition-all duration-300 ease-in-out"
      style={{
        gridTemplateRows: visible ? "1fr" : "0fr",
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="overflow-hidden">
        <div className={`mx-3 mt-3 rounded-md border px-3 py-2 flex items-center gap-2.5 ${visible ? "border-danger/30 bg-danger/10 text-danger" : ""}`}>
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{sessionErrorMessage}</span>
        </div>
      </div>
    </div>
  );
}
