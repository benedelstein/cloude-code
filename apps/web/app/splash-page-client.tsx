"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Github, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { CloudButton } from "@/components/ui/cloud-button";
import { CloudBackground } from "@/components/backgrounds/cloud-background";

interface SplashPageClientProps {
  hasSessionCookie: boolean;
}

export function SplashPageClient({ hasSessionCookie }: SplashPageClientProps) {
  const router = useRouter();
  const { loading, isAuthenticated, login, authError } = useAuth();
  const [loginStarted, setLoginStarted] = useState(false);
  const hasDashboardAccess = isAuthenticated || (loading && hasSessionCookie);

  useEffect(() => {
    if (authError) {
      toast.error(authError);
    }
  }, [authError]);

  useEffect(() => {
    if (loginStarted && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, loginStarted, router]);

  const handleSignIn = () => {
    setLoginStarted(true);
    void login();
  };

  return (
    <main className="relative min-h-svh overflow-hidden text-foreground">
      <CloudBackground />

      <header className="relative z-10 flex h-20 items-center justify-end px-5 sm:px-8">
        {hasDashboardAccess ? (
          <CloudButton href="/dashboard" className="h-10 px-4 text-sm" variant="quiet">
            Go to dashboard
            <ArrowRight className="h-4 w-4" />
          </CloudButton>
        ) : (
          <CloudButton
            className="h-10 px-4 text-sm"
            disabled={loading}
            onClick={handleSignIn}
            variant="quiet"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Github className="h-4 w-4" />
            )}
            Sign in
          </CloudButton>
        )}
      </header>

      <section className="relative z-10 mx-auto flex min-h-[calc(100svh-5rem)] max-w-5xl flex-col items-center justify-center px-5 pb-24 pt-10 text-center sm:px-8">
        <div className="flex flex-col items-center">
          <h1
            className="font-display text-5xl font-normal text-white leading-[0.96] tracking-normal sm:text-7xl lg:text-8xl"
            style={{ WebkitTextStroke: "4px #1f2d3d", paintOrder: "stroke fill" }}
          >
            Cloude Code
          </h1>
          <p
            className="mt-4 max-w-xl text-pretty text-base text-secondary-foreground sm:text-lg"
          >
            Run a team of coding agents, each with their own computer.
          </p>

          <div className="mt-8 flex justify-center">
            {hasDashboardAccess ? (
              <CloudButton href="/dashboard" className="h-14 px-6 text-base">
                Get started
                <ArrowRight className="h-5 w-5" />
              </CloudButton>
            ) : (
              <CloudButton
                className="h-14 px-6 text-base"
                disabled={loading}
                onClick={handleSignIn}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ArrowRight className="h-5 w-5" />
                )}
                Get started
              </CloudButton>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
