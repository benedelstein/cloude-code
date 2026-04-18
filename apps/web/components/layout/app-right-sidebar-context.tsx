"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const RIGHT_SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
export const APP_RIGHT_SIDEBAR_WIDTH = "18rem";
export const APP_RIGHT_SIDEBAR_BUTTON_GUTTER = "3rem";

const AppRightSidebarSlotContext = createContext<HTMLDivElement | null>(null);
const AppRightSidebarSlotSetterContext = createContext<((node: HTMLDivElement | null) => void) | null>(null);

interface AppRightSidebarControls {
  enabled: boolean;
  open: boolean;
  mobileOpen: boolean;
  setEnabled: (enabled: boolean) => void;
  setOpen: (open: boolean) => void;
  setMobileOpen: (open: boolean) => void;
}

const AppRightSidebarControlsContext = createContext<AppRightSidebarControls | null>(null);

interface AppRightSidebarProviderProps {
  children: ReactNode;
  defaultOpen?: boolean;
  defaultEnabled?: boolean;
  cookieName?: string;
}

export function AppRightSidebarProvider({
  children,
  defaultOpen = true,
  defaultEnabled = false,
  cookieName = "right_sidebar_state",
}: AppRightSidebarProviderProps) {
  const [slotNode, setSlotNode] = useState<HTMLDivElement | null>(null);
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [open, setOpenState] = useState(defaultOpen);
  const [mobileOpen, setMobileOpen] = useState(false);

  useLayoutEffect(() => {
    setEnabled(defaultEnabled);
  }, [defaultEnabled]);

  const setOpen = useCallback((nextOpen: boolean) => {
    setOpenState(nextOpen);
    document.cookie = `${cookieName}=${nextOpen}; path=/; max-age=${RIGHT_SIDEBAR_COOKIE_MAX_AGE}`;
  }, [cookieName]);

  const controls = useMemo<AppRightSidebarControls>(() => ({
    enabled,
    open,
    mobileOpen,
    setEnabled,
    setOpen,
    setMobileOpen,
  }), [enabled, mobileOpen, open, setOpen]);

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
