"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const AppHeaderSlotContext = createContext<HTMLDivElement | null>(null);
const AppHeaderSlotSetterContext = createContext<((node: HTMLDivElement | null) => void) | null>(null);

export function AppHeaderProvider({ children }: { children: ReactNode }) {
  const [slotNode, setSlotNode] = useState<HTMLDivElement | null>(null);

  return (
    <AppHeaderSlotSetterContext.Provider value={setSlotNode}>
      <AppHeaderSlotContext.Provider value={slotNode}>
        {children}
      </AppHeaderSlotContext.Provider>
    </AppHeaderSlotSetterContext.Provider>
  );
}

export function AppHeaderSlot() {
  const setSlotNode = useContext(AppHeaderSlotSetterContext);
  return <div ref={setSlotNode} className="flex-1 min-w-0 h-full flex items-center empty:hidden" />;
}

export function AppHeaderPortal({ children }: { children: ReactNode }) {
  const slotNode = useContext(AppHeaderSlotContext);
  if (!slotNode) return null;
  return createPortal(children, slotNode);
}
