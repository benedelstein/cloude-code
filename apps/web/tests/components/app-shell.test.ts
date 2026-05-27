import { act, createElement, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/session/session-1",
}));

vi.mock("@/components/sidebar/session-sidebar", () => ({
  SessionSidebar: ({ resizeHandle }: { resizeHandle?: ReactNode }) =>
    createElement("aside", { "data-testid": "left-sidebar" }, resizeHandle),
}));

import { AppShell } from "@/components/layout/app-shell";

describe("AppShell", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("server-renders cookie-backed sidebar widths as CSS fallbacks", async () => {
    const element = createElement(
      AppShell,
      {
        defaultSidebarOpen: true,
        defaultRightSidebarOpen: false,
        defaultLeftSidebarWidthPx: 360,
        defaultRightSidebarWidthPx: 640,
        children: createElement("main", null, "Session content"),
      },
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.appendChild(container);

    const sidebarProvider = container.querySelector("[style*='--sidebar-width']");

    expect(sidebarProvider).toBeTruthy();
    expect((sidebarProvider as HTMLElement).style.getPropertyValue("--sidebar-width"))
      .toBe("var(--left-sidebar-width, 360px)");

    const sidebarWidthValues = Array.from(
      container.querySelectorAll("[style*='--sidebar-width']"),
      (elementWithStyle) =>
        (elementWithStyle as HTMLElement).style.getPropertyValue("--sidebar-width"),
    );

    expect(sidebarWidthValues).toContain("var(--app-right-sidebar-width, 640px)");

    let root: Root | null = null;
    await act(async () => {
      root = hydrateRoot(container, element);
    });

    expect(document.documentElement.style.getPropertyValue("--left-sidebar-width"))
      .toBe("360px");
    expect(document.documentElement.style.getPropertyValue("--app-right-sidebar-width"))
      .toBe("640px");

    await act(async () => {
      root?.unmount();
    });
  });
});
