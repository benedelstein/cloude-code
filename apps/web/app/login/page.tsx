"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/use-auth";
import { LoadingSpinner } from "@/components/parts/loading-spinner";

export default function LoginPage() {
  const { loading, isAuthenticated, login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.replace("/");
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <LoadingSpinner />
      </main>
    );
  }

  if (isAuthenticated) {
    return null;
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background-secondary to-accent-subtle">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-lg p-10">
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/claude_logo.svg"
            alt="Cloude Code"
            width={48}
            height={48}
            className="mb-5"
          />
          <h1 className="text-2xl font-semibold mb-2 text-foreground">
            Cloude Code
          </h1>
          <p className="text-sm text-foreground-muted">
            Sign in to start building
          </p>
        </div>

        <button
          onClick={login}
          className="w-full cursor-pointer py-3 px-4 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2.5"
        >
          <Image
            src="/github_logo.svg"
            alt="GitHub"
            width={20}
            height={20}
            className="invert"
          />
          Sign in with GitHub
        </button>

        <p className="text-xs text-foreground-muted text-center mt-6 leading-relaxed">
          By signing in, you agree to our{" "}
          <span className="underline">Terms of Service</span> and{" "}
          <span className="underline">Privacy Policy</span>.
        </p>
      </div>
    </main>
  );
}
