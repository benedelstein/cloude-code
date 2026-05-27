"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  PanelRightClose,
  type LucideIcon,
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
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH_PX,
  LEFT_SIDEBAR_MAX_WIDTH_PX,
  LEFT_SIDEBAR_MIN_WIDTH_PX,
  LEFT_SIDEBAR_WIDTH_COOKIE_MAX_AGE,
  LEFT_SIDEBAR_WIDTH_CSS_VARIABLE,
  LEFT_SIDEBAR_WIDTH_COOKIE_NAME,
  clampLeftSidebarWidth,
} from "@/components/layout/sidebar-width-persistence";

interface AppShellProps {
  children: React.ReactNode;
  defaultSidebarOpen?: boolean;
  defaultRightSidebarOpen?: boolean;
  defaultLeftSidebarWidthPx?: number;
  defaultRightSidebarWidthPx?: number;
}

const FLOATING_SIDEBAR_PADDING_PX = 4;
const SIDEBAR_HEADER_HEIGHT_PX = 56;
const FLOATING_SIDEBAR_TOGGLE_SIZE_PX = 28;
const FLOATING_SIDEBAR_TOGGLE_TOP_PX =
  FLOATING_SIDEBAR_PADDING_PX
  + (SIDEBAR_HEADER_HEIGHT_PX - FLOATING_SIDEBAR_TOGGLE_SIZE_PX) / 2;

export function AppShell({
  children,
  defaultSidebarOpen,
  defaultRightSidebarOpen,
  defaultLeftSidebarWidthPx = LEFT_SIDEBAR_DEFAULT_WIDTH_PX,
  defaultRightSidebarWidthPx,
}: AppShellProps) {
  const pathname = usePathname();
  const isSessionPage = pathname.startsWith("/session/");
  const [leftSidebarWidthPx, setLeftSidebarWidthPxState] = useState(
    clampLeftSidebarWidth(defaultLeftSidebarWidthPx),
  );
  const [isLeftSidebarResizing, setIsLeftSidebarResizing] = useState(false);
  const [sidebarLayoutReady, setSidebarLayoutReady] = useState(false);

  useLayoutEffect(() => {
    setLeftSidebarCssWidth(leftSidebarWidthPx);
    persistLeftSidebarWidthCookie(leftSidebarWidthPx);
    setSidebarLayoutReady(true);
  }, [leftSidebarWidthPx]);

  const setLeftSidebarWidthPx = useCallback(
    (nextWidthPx: number, options: { persist?: boolean } = {}) => {
      const clampedWidth = clampLeftSidebarWidth(nextWidthPx);
      setLeftSidebarWidthPxState(clampedWidth);
      setLeftSidebarCssWidth(clampedWidth);
      if (options.persist !== false) {
        persistLeftSidebarWidthCookie(clampedWidth);
      }
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      keyboardShortcut={{ code: "Digit0", shiftKey: false }}
      className={cn(
        "relative min-h-0! h-svh bg-background-secondary",
        (!sidebarLayoutReady || isLeftSidebarResizing)
          && "[&_[data-sidebar=gap]]:transition-none [&_[data-sidebar=gap]]:duration-0",
      )}
      style={{
        "--sidebar-width": `var(${LEFT_SIDEBAR_WIDTH_CSS_VARIABLE}, ${leftSidebarWidthPx}px)`,
      } as CSSProperties}
    >
      <AppHeaderProvider>
        <AppRightSidebarProvider
          defaultOpen={defaultRightSidebarOpen}
          defaultEnabled={isSessionPage}
          defaultWidthPx={defaultRightSidebarWidthPx}
        >
          <AppShellLayout
            leftSidebarWidthPx={leftSidebarWidthPx}
            sidebarLayoutReady={sidebarLayoutReady}
            isLeftSidebarResizing={isLeftSidebarResizing}
            onLeftSidebarWidthChange={setLeftSidebarWidthPx}
            onLeftSidebarPreviewWidthChange={(nextWidthPx) =>
              setLeftSidebarCssWidth(nextWidthPx)}
            onLeftSidebarResizeStateChange={setIsLeftSidebarResizing}
          >
            {children}
          </AppShellLayout>
        </AppRightSidebarProvider>
      </AppHeaderProvider>
    </SidebarProvider>
  );
}

function AppShellLayout({
  children,
  leftSidebarWidthPx,
  sidebarLayoutReady,
  isLeftSidebarResizing,
  onLeftSidebarWidthChange,
  onLeftSidebarPreviewWidthChange,
  onLeftSidebarResizeStateChange,
}: {
  children: React.ReactNode;
  leftSidebarWidthPx: number;
  sidebarLayoutReady: boolean;
  isLeftSidebarResizing: boolean;
  onLeftSidebarWidthChange: (
    widthPx: number,
    options?: { persist?: boolean },
  ) => void;
  onLeftSidebarPreviewWidthChange: (widthPx: number) => void;
  onLeftSidebarResizeStateChange: (isResizing: boolean) => void;
}) {
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
  const rightSidebarCssWidth = useMemo(
    () => `var(--app-right-sidebar-width, ${widthPx}px)`,
    [widthPx],
  );
  const headerMaxWidth = "56rem";
  const desktopRightSidebarReserve =
    enabled && !isMobile && open ? rightSidebarCssWidth : "0rem";
  const leftHeaderOverlayReserve =
    isMobile || !isLeftSidebarOpen ? APP_RIGHT_SIDEBAR_BUTTON_GUTTER : "0rem";
  const rightHeaderOverlayReserve =
    enabled && (isMobile || !open) ? APP_RIGHT_SIDEBAR_BUTTON_GUTTER : "0rem";
  const centeredHeaderMargin = `calc((100% - ${headerMaxWidth} - ${desktopRightSidebarReserve}) / 2)`;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 h-0">
        <FloatingSidebarToggle
          side="left"
          isOpen={isLeftSidebarOpen}
          openIcon={PanelLeftOpen}
          closeIcon={PanelLeftClose}
          openLabel="Open left sidebar"
          closeLabel="Collapse left sidebar"
          openTooltip="Open left sidebar (⌘0)"
          closeTooltip="Collapse left sidebar (⌘0)"
          onClick={toggleSidebar}
        />

        <FloatingSidebarToggle
          side="right"
          isOpen={isRightSidebarOpen}
          openIcon={PanelRightOpen}
          closeIcon={PanelRightClose}
          openLabel="Open right sidebar"
          closeLabel="Collapse right sidebar"
          openTooltip="Open right sidebar (⌘⌥0)"
          closeTooltip="Collapse right sidebar (⌘⌥0)"
          onClick={() => {
            if (isMobile) {
              setMobileOpen(!mobileOpen);
              return;
            }

            setOpen(!open);
          }}
          className={cn(
            getFadeScaleVisibilityClasses(enabled, {
              durationClass: "duration-120",
            }),
          )}
        />
      </div>

      <SessionSidebar
        className={cn(
          "[&_[data-sidebar=sidebar]]:relative",
          "p-1",
          (!sidebarLayoutReady || isLeftSidebarResizing)
            && "transition-none duration-0",
        )}
        resizeHandle={
          <LeftSidebarResizeHandle
            widthPx={leftSidebarWidthPx}
            onWidthChange={onLeftSidebarWidthChange}
            onPreviewWidthChange={onLeftSidebarPreviewWidthChange}
            onResizeStateChange={onLeftSidebarResizeStateChange}
          />
        }
      />
      <SidebarInset className="overflow-hidden bg-background-secondary">
        <div className="sticky top-0 z-10 h-0">
          <div
            className="pt-1 pb-8 has-[.header-card:empty]:pt-0 has-[.header-card:empty]:pb-0"
            style={{
              background: "linear-gradient(to bottom, var(--background-secondary) 0, var(--background-secondary) 60px, transparent 100%)",
            }}
          >
            <div
              className={cn(
                "max-w-4xl min-w-0 px-4 h-full flex items-center",
                sidebarLayoutReady
                  && !isRightSidebarResizing
                  && "transition-[margin] duration-200 ease-linear",
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
        style={{ "--sidebar-width": rightSidebarCssWidth } as CSSProperties}
      >
        <Sidebar
          side="right"
          collapsible="offcanvas"
          variant="floating"
          reserveSpace={false}
          className={cn(
            "[&_[data-sidebar=sidebar]]:relative [&_[data-sidebar=sidebar]]:bg-sidebar",
            "p-1",
            (!sidebarLayoutReady || isRightSidebarResizing)
              && "transition-none duration-0",
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

function FloatingSidebarToggle({
  side,
  isOpen,
  openIcon: OpenIcon,
  closeIcon: CloseIcon,
  openLabel,
  closeLabel,
  openTooltip,
  closeTooltip,
  onClick,
  className,
}: {
  side: "left" | "right";
  isOpen: boolean;
  openIcon: LucideIcon;
  closeIcon: LucideIcon;
  openLabel: string;
  closeLabel: string;
  openTooltip: string;
  closeTooltip: string;
  onClick: () => void;
  className?: string;
}) {
  const Icon = isOpen ? CloseIcon : OpenIcon;
  const label = isOpen ? closeLabel : openLabel;
  const tooltip = isOpen ? closeTooltip : openTooltip;

  return (
    <div
      className={cn(
        "absolute flex",
        side === "left" ? "left-5" : "right-5",
        className,
      )}
      style={{ top: FLOATING_SIDEBAR_TOGGLE_TOP_PX }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="pointer-events-auto h-7 w-7 text-foreground-secondary hover:bg-transparent hover:text-foreground"
            onClick={onClick}
          >
            <Icon className="h-4 w-4" />
            <span className="sr-only">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side === "left" ? "right" : "left"}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function LeftSidebarResizeHandle({
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
      nextWidthPx = startWidthPx + moveEvent.clientX - startClientX;
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
      aria-label="Resize left sidebar"
      title="Resize left sidebar"
      onPointerDown={handlePointerDown}
      onKeyDown={(event) => {
        switch (event.key) {
          case "ArrowLeft":
            event.preventDefault();
            onWidthChange(widthPx - 16);
            break;
          case "ArrowRight":
            event.preventDefault();
            onWidthChange(widthPx + 16);
            break;
          case "Home":
            event.preventDefault();
            onWidthChange(LEFT_SIDEBAR_MIN_WIDTH_PX);
            break;
          case "End":
            event.preventDefault();
            onWidthChange(LEFT_SIDEBAR_MAX_WIDTH_PX);
            break;
          default:
            break;
        }
      }}
      className="absolute right-0 top-0 z-20 hidden h-full w-3 translate-x-1/2 cursor-col-resize! touch-none md:block after:absolute after:inset-y-2 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-sidebar-border focus-visible:outline-none focus-visible:after:bg-sidebar-ring"
    />
  );
}

function setLeftSidebarCssWidth(widthPx: number) {
  document.documentElement.style.setProperty(
    LEFT_SIDEBAR_WIDTH_CSS_VARIABLE,
    `${clampLeftSidebarWidth(widthPx)}px`,
  );
}

function persistLeftSidebarWidthCookie(widthPx: number) {
  document.cookie = `${LEFT_SIDEBAR_WIDTH_COOKIE_NAME}=${clampLeftSidebarWidth(widthPx)}; path=/; max-age=${LEFT_SIDEBAR_WIDTH_COOKIE_MAX_AGE}; SameSite=Lax`;
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
