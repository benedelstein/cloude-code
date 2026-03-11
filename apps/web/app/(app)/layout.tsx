"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/layout/app-shell";
import { SessionListProvider } from "@/components/providers/session-list-provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { loading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return <div className="h-screen" />;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SessionListProvider>
      <AppShell>{children}</AppShell>
    </SessionListProvider>
  );
}
