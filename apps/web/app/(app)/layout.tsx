import { AppShell } from "@/components/layout/app-shell";
import { SessionListProvider } from "@/components/providers/session-list-provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionListProvider>
      <AppShell>{children}</AppShell>
    </SessionListProvider>
  );
}
