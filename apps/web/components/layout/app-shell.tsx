"use client";

import { PanelLeftClose, PanelLeftOpen, PanelRightOpen, PanelRightClose } from "lucide-react";
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
import { cn, getFadeScaleVisibilityClasses } from "@/lib/utils";

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
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      keyboardShortcut={{ code: "Digit0", shiftKey: false }}
      className="relative min-h-0! h-svh"
    >
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
  const isRightSidebarOpen = enabled && open;
  const rightHeaderReserve = !enabled
    ? "0rem"
    : isRightSidebarOpen
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
                {isLeftSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                <span className="sr-only">
                  {isLeftSidebarOpen ? "Collapse left sidebar" : "Open left sidebar"}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isLeftSidebarOpen ? "Collapse left sidebar (⌘0)" : "Open left sidebar (⌘0)"}
            </TooltipContent>
          </Tooltip>
        </div>

        <div
          className={cn(
            `absolute right-5 top-2 hidden ${SIDEBAR_HEADER_HEIGHT_CLASS} items-center md:flex`,
            getFadeScaleVisibilityClasses(enabled, {
              durationClass: "duration-120",
            }),
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="pointer-events-auto h-7 w-7 border border-border bg-background shadow-shadow shadow-lg"
                onClick={() => setOpen(!isRightSidebarOpen)}
              >
                {isRightSidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                <span className="sr-only">
                  {isRightSidebarOpen ? "Collapse right sidebar" : "Open right sidebar"}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isRightSidebarOpen ? "Collapse right sidebar (⌘⌥0)" : "Open right sidebar (⌘⌥0)"}
            </TooltipContent>
          </Tooltip>
        </div>
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

      <SidebarProvider
        open={isRightSidebarOpen}
        onOpenChange={setOpen}
        cookieName="right_sidebar_state"
        keyboardShortcut={{ code: "Digit0", altKey: true }}
        layout="contents"
      >
        <Sidebar
          side="right"
          collapsible="offcanvas"
          variant="floating"
          reserveSpace={false}
          className="**:data-[sidebar=sidebar]:bg-sidebar"
        >
          <AppRightSidebarSlot />
        </Sidebar>
      </SidebarProvider>
    </>
  );
}
