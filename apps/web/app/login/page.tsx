"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/use-auth";
import { LoadingSpinner } from "@/components/parts/loading-spinner";

export default function LoginPage() {
  const { loading, isAuthenticated, login, authError } = useAuth();
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
    <main className="min-h-screen flex items-center justify-center p-4 bg-background-secondary">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background shadow-shadow shadow-xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 text-accent">Cloude Code</h1>
          <p className="text-sm text-foreground-muted">
            Connect your Github to start building
          </p>
        </div>

        <button
          onClick={login}
          className="w-full cursor-pointer py-3 px-4 rounded-lg border border-border bg-background text-foreground font-medium shadow-shadow shadow-md hover:bg-background-secondary transition-colors flex items-center justify-center gap-2"
        >
          <Image src="/github_logo.svg" alt="GitHub" width={20} height={20} />
          Sign in with GitHub
        </button>

        {authError ? (
          <p className="mt-4 text-sm text-red-600">
            {authError}
          </p>
        ) : null}
      </div>
    </main>
  );
}
