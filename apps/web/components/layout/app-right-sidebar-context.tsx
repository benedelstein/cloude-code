"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  APP_RIGHT_SIDEBAR_DEFAULT_WIDTH_PX,
  APP_RIGHT_SIDEBAR_MAX_WIDTH_PX,
  APP_RIGHT_SIDEBAR_MIN_WIDTH_PX,
  RIGHT_SIDEBAR_WIDTH_COOKIE_MAX_AGE,
  RIGHT_SIDEBAR_WIDTH_CSS_VARIABLE,
  RIGHT_SIDEBAR_WIDTH_COOKIE_NAME,
  clampRightSidebarWidth,
} from "@/components/layout/sidebar-width-persistence";

const RIGHT_SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
export const APP_RIGHT_SIDEBAR_BUTTON_GUTTER = "3rem";
export {
  APP_RIGHT_SIDEBAR_MAX_WIDTH_PX,
  APP_RIGHT_SIDEBAR_MIN_WIDTH_PX,
};

const AppRightSidebarSlotContext = createContext<HTMLDivElement | null>(null);
const AppRightSidebarSlotSetterContext = createContext<((node: HTMLDivElement | null) => void) | null>(null);

interface AppRightSidebarControls {
  enabled: boolean;
  open: boolean;
  mobileOpen: boolean;
  widthPx: number;
  isResizing: boolean;
  setEnabled: (enabled: boolean) => void;
  setOpen: (open: boolean) => void;
  setMobileOpen: (open: boolean) => void;
  setWidthPx: (widthPx: number, options?: { persist?: boolean }) => void;
  setPreviewWidthPx: (widthPx: number) => void;
  setIsResizing: (isResizing: boolean) => void;
}

const AppRightSidebarControlsContext = createContext<AppRightSidebarControls | null>(null);

interface AppRightSidebarProviderProps {
  children: ReactNode;
  defaultOpen?: boolean;
  defaultEnabled?: boolean;
  defaultWidthPx?: number;
  cookieName?: string;
}

export function AppRightSidebarProvider({
  children,
  defaultOpen = true,
  defaultEnabled = false,
  defaultWidthPx = APP_RIGHT_SIDEBAR_DEFAULT_WIDTH_PX,
  cookieName = "right_sidebar_state",
}: AppRightSidebarProviderProps) {
  const [slotNode, setSlotNode] = useState<HTMLDivElement | null>(null);
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [open, setOpenState] = useState(defaultOpen);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [widthPx, setWidthPxState] = useState(
    clampRightSidebarWidth(defaultWidthPx),
  );
  const [isResizing, setIsResizing] = useState(false);

  useLayoutEffect(() => {
    setEnabled(defaultEnabled);
  }, [defaultEnabled]);

  useLayoutEffect(() => {
    setRightSidebarCssWidth(widthPx);
    persistRightSidebarWidthCookie(widthPx);
  }, [widthPx]);

  const setOpen = useCallback((nextOpen: boolean) => {
    setOpenState(nextOpen);
    document.cookie = `${cookieName}=${nextOpen}; path=/; max-age=${RIGHT_SIDEBAR_COOKIE_MAX_AGE}`;
  }, [cookieName]);

  const setWidthPx = useCallback((nextWidthPx: number, options: { persist?: boolean } = {}) => {
    const clampedWidth = clampRightSidebarWidth(nextWidthPx);
    setWidthPxState(clampedWidth);
    setRightSidebarCssWidth(clampedWidth);
    if (options.persist !== false) {
      persistRightSidebarWidthCookie(clampedWidth);
    }
  }, []);

  const setPreviewWidthPx = useCallback((nextWidthPx: number) => {
    setRightSidebarCssWidth(nextWidthPx);
  }, []);

  const controls = useMemo<AppRightSidebarControls>(() => ({
    enabled,
    open,
    mobileOpen,
    widthPx,
    isResizing,
    setEnabled,
    setOpen,
    setMobileOpen,
    setWidthPx,
    setPreviewWidthPx,
    setIsResizing,
  }), [enabled, isResizing, mobileOpen, open, setOpen, setPreviewWidthPx, setWidthPx, widthPx]);

  return (
    <AppRightSidebarControlsContext.Provider value={controls}>
      <AppRightSidebarSlotSetterContext.Provider value={setSlotNode}>
        <AppRightSidebarSlotContext.Provider value={slotNode}>
          {children}
        </AppRightSidebarSlotContext.Provider>
      </AppRightSidebarSlotSetterContext.Provider>
    </AppRightSidebarControlsContext.Provider>
  );
}

export function useAppRightSidebar(): AppRightSidebarControls {
  const context = useContext(AppRightSidebarControlsContext);
  if (!context) {
    throw new Error("useAppRightSidebar must be used within an AppRightSidebarProvider");
  }
  return context;
}

export function AppRightSidebarSlot() {
  const setSlotNode = useContext(AppRightSidebarSlotSetterContext);
  return <div ref={setSlotNode} className="flex min-h-0 flex-1 flex-col" />;
}

export function AppRightSidebarPortal({ children }: { children: ReactNode }) {
  const slotNode = useContext(AppRightSidebarSlotContext);
  const { setEnabled } = useAppRightSidebar();

  useLayoutEffect(() => {
    setEnabled(true);
    return () => setEnabled(false);
  }, [setEnabled]);

  if (!slotNode) {
    return null;
  }

  return createPortal(children, slotNode);
}

function setRightSidebarCssWidth(widthPx: number) {
  document.documentElement.style.setProperty(
    RIGHT_SIDEBAR_WIDTH_CSS_VARIABLE,
    `${clampRightSidebarWidth(widthPx)}px`,
  );
}

function persistRightSidebarWidthCookie(widthPx: number) {
  document.cookie = `${RIGHT_SIDEBAR_WIDTH_COOKIE_NAME}=${clampRightSidebarWidth(widthPx)}; path=/; max-age=${RIGHT_SIDEBAR_WIDTH_COOKIE_MAX_AGE}; SameSite=Lax`;
}
