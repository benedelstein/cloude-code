"use client";

import { PanelLeft, PanelRight } from "lucide-react";
import { SessionSidebar } from "@/components/sidebar/session-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  Sidebar,
  SIDEBAR_HEADER_HEIGHT_CLASS,
  useSidebar,
} from "@/components/ui/sidebar";
import { AppHeaderProvider, AppHeaderSlot } from "@/components/layout/app-header-context";
import {
  AppRightSidebarProvider,
  AppRightSidebarSlot,
  APP_RIGHT_SIDEBAR_BUTTON_GUTTER,
  APP_RIGHT_SIDEBAR_WIDTH,
  useAppRightSidebar,
} from "@/components/layout/app-right-sidebar-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface AppShellProps {
  children: React.ReactNode;
  defaultSidebarOpen?: boolean;
  defaultRightSidebarOpen?: boolean;
}

export function AppShell({
  children,
  defaultSidebarOpen,
  defaultRightSidebarOpen,
}: AppShellProps) {
  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen} className="relative min-h-0! h-svh">
      <AppHeaderProvider>
        <AppRightSidebarProvider defaultOpen={defaultRightSidebarOpen}>
          <AppShellLayout>{children}</AppShellLayout>
        </AppRightSidebarProvider>
      </AppHeaderProvider>
    </SidebarProvider>
  );
}

function AppShellLayout({ children }: { children: React.ReactNode }) {
  const { open: isLeftSidebarOpen, toggleSidebar } = useSidebar();
  const { enabled, open, setOpen } = useAppRightSidebar();
  const rightHeaderReserve = !enabled
    ? "0rem"
    : open
      ? APP_RIGHT_SIDEBAR_WIDTH
      : APP_RIGHT_SIDEBAR_BUTTON_GUTTER;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 h-0">
        <div className={`absolute left-5 top-2 hidden ${SIDEBAR_HEADER_HEIGHT_CLASS} items-center md:flex`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="pointer-events-auto h-7 w-7 border border-border bg-background shadow-shadow shadow-lg"
                onClick={toggleSidebar}
              >
                <PanelLeft className="h-4 w-4" />
                <span className="sr-only">
                  {isLeftSidebarOpen ? "Collapse session list" : "Open session list"}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isLeftSidebarOpen ? "Collapse session list" : "Open session list"}
            </TooltipContent>
          </Tooltip>
        </div>

        {enabled && (
          <div className={`absolute right-5 top-2 hidden ${SIDEBAR_HEADER_HEIGHT_CLASS} items-center md:flex`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="pointer-events-auto h-7 w-7 border border-border bg-background shadow-shadow shadow-lg"
                  onClick={() => setOpen(!open)}
                >
                  <PanelRight className="h-4 w-4" />
                  <span className="sr-only">
                    {open ? "Collapse session sidebar" : "Open session sidebar"}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {open ? "Collapse session sidebar" : "Open session sidebar"}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      <SessionSidebar />
      <SidebarInset className="overflow-hidden">
        <div className="sticky top-0 z-10 h-0">
          <div className="pt-2 pb-2 has-[.header-card:empty]:pt-0 has-[.header-card:empty]:pb-0">
            <div
              className="max-w-4xl px-4 h-full flex items-center transition-[margin] duration-200 ease-linear"
              style={{
                marginLeft: `max(0rem, calc((100% - 56rem - ${rightHeaderReserve}) / 2))`,
                marginRight: `max(${rightHeaderReserve}, calc((100% - 56rem + ${rightHeaderReserve}) / 2))`,
              }}
            >
              <div className={`header-card flex ${SIDEBAR_HEADER_HEIGHT_CLASS} flex-1 items-center rounded-lg border border-border bg-background px-3 shadow-shadow shadow-xl has-[>:empty]:hidden`}>
                <AppHeaderSlot />
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0">{children}</div>
      </SidebarInset>

      {enabled && (
        <SidebarProvider
          open={open}
          onOpenChange={setOpen}
          cookieName="right_sidebar_state"
          keyboardShortcut={null}
          layout="contents"
        >
          <Sidebar
            side="right"
            collapsible="offcanvas"
            variant="floating"
            reserveSpace={false}
            className="[&_[data-sidebar=sidebar]]:bg-sidebar"
          >
            <AppRightSidebarSlot />
          </Sidebar>
        </SidebarProvider>
      )}
    </>
  );
}
