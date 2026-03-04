"use client";

import { SessionSidebar } from "@/components/sidebar/session-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppHeaderProvider, AppHeaderSlot } from "@/components/layout/app-header-context";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppHeaderProvider>
        <SessionSidebar />
        <SidebarInset>
          <div className="shrink-0 h-12 mt-2 px-4 flex items-center gap-3">
            <SidebarTrigger title="Open/close sidebar" className="shrink-0" />
            <div className="flex-1 min-w-0 flex justify-center">
              <div className="w-full max-w-4xl">
                <AppHeaderSlot />
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0">{children}</div>
        </SidebarInset>
      </AppHeaderProvider>
    </SidebarProvider>
  );
}
