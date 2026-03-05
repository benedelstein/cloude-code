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
          {/* Toggle button - aligned with sidebar header */}
          <div className="sticky top-0 z-20 h-0">
            <div className="absolute left-4 top-2 h-14 flex items-center">
              <SidebarTrigger title="Open/close sidebar" className="bg-background shadow border border-border" />
            </div>
          </div>

          {/* Sticky header */}
          <div className="shrink-0 sticky top-0 z-10 pt-2 pb-2 has-[.header-card:empty]:pt-0 has-[.header-card:empty]:pb-0">
            <div
              className="max-w-4xl px-4 h-full flex items-center"
              style={{
                marginLeft: "max(3rem, calc((100% - 56rem) / 2))",
                marginRight: "max(0rem, calc((100% - 56rem) / 2))",
              }}
            >
              <div className="header-card flex-1 flex items-center rounded-lg border border-border shadow-sm bg-background px-3 py-2 has-[>:empty]:hidden">
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
