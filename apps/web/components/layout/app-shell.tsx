"use client";

import { SessionSidebar } from "@/components/sidebar/session-sidebar";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen">
      <SessionSidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
