"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { SessionSidebar } from "@/components/sidebar/session-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  Sidebar,
  SIDEBAR_HEADER_HEIGHT_CLASS,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  AppHeaderProvider,
  AppHeaderSlot,
} from "@/components/layout/app-header-context";
import {
  AppRightSidebarProvider,
  AppRightSidebarSlot,
  APP_RIGHT_SIDEBAR_BUTTON_GUTTER,
  APP_RIGHT_SIDEBAR_CSS_WIDTH,
  APP_RIGHT_SIDEBAR_MAX_WIDTH_PX,
  APP_RIGHT_SIDEBAR_MIN_WIDTH_PX,
  useAppRightSidebar,
} from "@/components/layout/app-right-sidebar-context";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const pathname = usePathname();
  const isSessionPage = pathname.startsWith("/session/");

  return (
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      keyboardShortcut={{ code: "Digit0", shiftKey: false }}
      className="relative min-h-0! h-svh bg-background-secondary"
    >
      <AppHeaderProvider>
        <AppRightSidebarProvider
          defaultOpen={defaultRightSidebarOpen}
          defaultEnabled={isSessionPage}
        >
          <AppShellLayout>{children}</AppShellLayout>
        </AppRightSidebarProvider>
      </AppHeaderProvider>
    </SidebarProvider>
  );
}

function AppShellLayout({ children }: { children: React.ReactNode }) {
  const { open: isLeftSidebarOpen, toggleSidebar, isMobile } = useSidebar();
  const {
    enabled,
    open,
    mobileOpen,
    widthPx,
    isResizing: isRightSidebarResizing,
    setOpen,
    setMobileOpen,
    setWidthPx,
    setPreviewWidthPx,
    setIsResizing: setIsRightSidebarResizing,
  } =
    useAppRightSidebar();
  const isRightSidebarOpen = enabled && (isMobile ? mobileOpen : open);
  const headerMaxWidth = "56rem";
  const desktopRightSidebarReserve =
    enabled && !isMobile && open ? APP_RIGHT_SIDEBAR_CSS_WIDTH : "0rem";
  const leftHeaderOverlayReserve =
    isMobile || !isLeftSidebarOpen ? APP_RIGHT_SIDEBAR_BUTTON_GUTTER : "0rem";
  const rightHeaderOverlayReserve =
    enabled && (isMobile || !open) ? APP_RIGHT_SIDEBAR_BUTTON_GUTTER : "0rem";
  const centeredHeaderMargin = `calc((100% - ${headerMaxWidth} - ${desktopRightSidebarReserve}) / 2)`;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 h-0">
        <div
          className={`absolute left-5 top-2 flex ${SIDEBAR_HEADER_HEIGHT_CLASS} items-center`}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="pointer-events-auto h-7 w-7 border border-border bg-background shadow-shadow shadow-lg"
                onClick={toggleSidebar}
              >
                {isLeftSidebarOpen ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeftOpen className="h-4 w-4" />
                )}
                <span className="sr-only">
                  {isLeftSidebarOpen
                    ? "Collapse left sidebar"
                    : "Open left sidebar"}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isLeftSidebarOpen
                ? "Collapse left sidebar (⌘0)"
                : "Open left sidebar (⌘0)"}
            </TooltipContent>
          </Tooltip>
        </div>

        <div
          className={cn(
            `absolute right-5 top-2 flex ${SIDEBAR_HEADER_HEIGHT_CLASS} items-center`,
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
                onClick={() => {
                  if (isMobile) {
                    setMobileOpen(!mobileOpen);
                    return;
                  }

                  setOpen(!open);
                }}
              >
                {isRightSidebarOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
                <span className="sr-only">
                  {isRightSidebarOpen
                    ? "Collapse right sidebar"
                    : "Open right sidebar"}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isRightSidebarOpen
                ? "Collapse right sidebar (⌘⌥0)"
                : "Open right sidebar (⌘⌥0)"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <SessionSidebar />
      <SidebarInset className="overflow-hidden bg-background-secondary">
        <div className="sticky top-0 z-10 h-0">
          <div className="pt-2 pb-2 has-[.header-card:empty]:pt-0 has-[.header-card:empty]:pb-0">
            <div
              className={cn(
                "max-w-4xl min-w-0 px-4 h-full flex items-center",
                !isRightSidebarResizing && "transition-[margin] duration-200 ease-linear",
              )}
              style={{
                marginLeft: `max(${leftHeaderOverlayReserve}, ${centeredHeaderMargin})`,
                marginRight: `calc(${desktopRightSidebarReserve} + max(${rightHeaderOverlayReserve}, ${centeredHeaderMargin}))`,
              }}
            >
              <div
                className={`header-card flex ${SIDEBAR_HEADER_HEIGHT_CLASS} min-w-0 flex-1 items-center rounded-lg border border-border bg-background px-3 shadow-shadow shadow-xl has-[>:empty]:hidden`}
              >
                <AppHeaderSlot />
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0">{children}</div>
      </SidebarInset>

      {/* right sidebar */}
      <SidebarProvider
        open={enabled ? open : false}
        onOpenChange={setOpen}
        openMobile={enabled ? mobileOpen : false}
        onOpenMobileChange={setMobileOpen}
        cookieName="right_sidebar_state"
        keyboardShortcut={enabled ? { code: "Digit0", altKey: true } : null}
        layout="contents"
        style={{ "--sidebar-width": APP_RIGHT_SIDEBAR_CSS_WIDTH } as CSSProperties}
      >
        <Sidebar
          side="right"
          collapsible="offcanvas"
          variant="floating"
          reserveSpace={false}
          className={cn(
            "[&_[data-sidebar=sidebar]]:relative [&_[data-sidebar=sidebar]]:bg-sidebar",
            isRightSidebarResizing && "transition-none duration-0",
          )}
        >
          <RightSidebarResizeHandle
            widthPx={widthPx}
            onWidthChange={setWidthPx}
            onPreviewWidthChange={setPreviewWidthPx}
            onResizeStateChange={setIsRightSidebarResizing}
          />
          <AppRightSidebarSlot />
        </Sidebar>
      </SidebarProvider>
    </>
  );
}

function RightSidebarResizeHandle({
  widthPx,
  onWidthChange,
  onPreviewWidthChange,
  onResizeStateChange,
}: {
  widthPx: number;
  onWidthChange: (widthPx: number, options?: { persist?: boolean }) => void;
  onPreviewWidthChange: (widthPx: number) => void;
  onResizeStateChange: (isResizing: boolean) => void;
}) {
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startClientX = event.clientX;
    const startWidthPx = widthPx;
    let nextWidthPx = startWidthPx;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    onResizeStateChange(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      nextWidthPx = startWidthPx + startClientX - moveEvent.clientX;
      onPreviewWidthChange(nextWidthPx);
    };

    const stopResizing = () => {
      onWidthChange(nextWidthPx);
      onResizeStateChange(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
  };

  return (
    <button
      type="button"
      aria-label="Resize right sidebar"
      title="Resize right sidebar"
      onPointerDown={handlePointerDown}
      onKeyDown={(event) => {
        switch (event.key) {
          case "ArrowLeft":
            event.preventDefault();
            onWidthChange(widthPx + 16);
            break;
          case "ArrowRight":
            event.preventDefault();
            onWidthChange(widthPx - 16);
            break;
          case "Home":
            event.preventDefault();
            onWidthChange(APP_RIGHT_SIDEBAR_MIN_WIDTH_PX);
            break;
          case "End":
            event.preventDefault();
            onWidthChange(APP_RIGHT_SIDEBAR_MAX_WIDTH_PX);
            break;
          default:
            break;
        }
      }}
      className="absolute left-0 top-0 z-20 hidden h-full w-3 -translate-x-1/2 cursor-col-resize! touch-none md:block after:absolute after:inset-y-2 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-sidebar-border focus-visible:outline-none focus-visible:after:bg-sidebar-ring"
    />
  );
}
