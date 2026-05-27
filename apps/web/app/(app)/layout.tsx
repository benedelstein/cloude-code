import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
import { SessionListProvider } from "@/components/providers/session-list-provider";
import {
  LEFT_SIDEBAR_WIDTH_COOKIE_NAME,
  RIGHT_SIDEBAR_WIDTH_COOKIE_NAME,
  parseLeftSidebarWidth,
  parseRightSidebarWidth,
} from "@/components/layout/sidebar-width-persistence";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const rightSidebarOpen = cookieStore.get("right_sidebar_state")?.value !== "false";
  const leftSidebarWidthPx = parseLeftSidebarWidth(
    cookieStore.get(LEFT_SIDEBAR_WIDTH_COOKIE_NAME)?.value,
  );
  const rightSidebarWidthPx = parseRightSidebarWidth(
    cookieStore.get(RIGHT_SIDEBAR_WIDTH_COOKIE_NAME)?.value,
  );

  return (
    <SessionListProvider>
      <AppShell
        defaultSidebarOpen={sidebarOpen}
        defaultRightSidebarOpen={rightSidebarOpen}
        defaultLeftSidebarWidthPx={leftSidebarWidthPx}
        defaultRightSidebarWidthPx={rightSidebarWidthPx}
      >
        {children}
      </AppShell>
    </SessionListProvider>
  );
}
