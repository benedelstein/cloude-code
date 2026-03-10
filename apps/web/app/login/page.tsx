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
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 text-accent">Cloude Code</h1>
          <p className="text-foreground-muted">
            Connect your Github to start building
          </p>
        </div>

        <button
          onClick={login}
          className="w-full cursor-pointer py-3 px-4 rounded-md bg-accent text-accent-foreground font-medium hover:bg-accent-hover transition-colors flex items-center justify-center gap-2"
        >
          <Image src="/github_logo.svg" alt="GitHub" width={20} height={20} />
          Sign in with GitHub
        </button>
      </div>
    </main>
  );
}
