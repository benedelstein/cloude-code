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
          <div className="shrink-0 h-12 mt-2 relative">
            <SidebarTrigger title="Open/close sidebar" className="absolute left-4 top-1/2 -translate-y-1/2 shrink-0 z-10" />
            <div className="max-w-4xl px-4 h-full flex items-center"
              style={{
                marginLeft: "max(3rem, calc((100% - 56rem) / 2))",
                marginRight: "max(0rem, calc((100% - 56rem) / 2))",
              }}
            >
              <AppHeaderSlot />
            </div>
          </div>
          <div className="flex-1 min-h-0">{children}</div>
        </SidebarInset>
      </AppHeaderProvider>
    </SidebarProvider>
  );
}
