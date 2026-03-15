import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
import { SessionListProvider } from "@/components/providers/session-list-provider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const rightSidebarOpen = cookieStore.get("right_sidebar_state")?.value !== "false";

  return (
    <SessionListProvider>
      <AppShell
        defaultSidebarOpen={sidebarOpen}
        defaultRightSidebarOpen={rightSidebarOpen}
      >
        {children}
      </AppShell>
    </SessionListProvider>
  );
}
