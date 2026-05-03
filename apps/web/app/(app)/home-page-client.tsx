"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { useAuth } from "@/hooks/use-auth";
import { SessionCreationForm } from "./session-creation-form";

type CloudConfig = {
  id: string;
  className: string;
  style: React.CSSProperties;
};

const cloudConfigs: CloudConfig[] = [
  {
    id: "cloud-a",
    className: "homepage-cloud homepage-cloud-large",
    style: {
      top: "11%",
      left: "10%",
      animationDuration: "32s",
      animationDelay: "-6s",
    },
  },
  {
    id: "cloud-b",
    className: "homepage-cloud homepage-cloud-medium",
    style: {
      top: "9%",
      right: "12%",
      animationDuration: "28s",
      animationDelay: "-14s",
    },
  },
  {
    id: "cloud-c",
    className: "homepage-cloud homepage-cloud-small",
    style: {
      top: "28%",
      left: "28%",
      animationDuration: "24s",
      animationDelay: "-11s",
    },
  },
  {
    id: "cloud-d",
    className: "homepage-cloud homepage-cloud-medium",
    style: {
      top: "33%",
      right: "10%",
      animationDuration: "30s",
      animationDelay: "-18s",
    },
  },
  {
    id: "cloud-e",
    className: "homepage-cloud homepage-cloud-large homepage-cloud-soft",
    style: {
      bottom: "12%",
      left: "52%",
      animationDuration: "36s",
      animationDelay: "-9s",
    },
  },
];

export function HomePageClient() {
  const { loading, isAuthenticated, login } = useAuth();
  const [pointerPosition, setPointerPosition] = useState({ x: 48, y: 24 });
  const accentStyle = useMemo(
    () =>
      ({
        "--pointer-x": `${pointerPosition.x}%`,
        "--pointer-y": `${pointerPosition.y}%`,
      }) as React.CSSProperties,
    [pointerPosition],
  );

  return (
    <div
      className="homepage-sky relative isolate flex min-h-full items-center justify-center overflow-hidden px-4 py-10"
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) * 100;
        const y = ((event.clientY - bounds.top) / bounds.height) * 100;
        setPointerPosition({ x, y });
      }}
      style={accentStyle}
    >
      <div className="homepage-grid pointer-events-none absolute inset-0" />
      <div className="homepage-glow pointer-events-none absolute inset-0" />
      <div className="homepage-haze pointer-events-none absolute inset-0" />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {cloudConfigs.map((cloud) => (
          <div key={cloud.id} className={cloud.className} style={cloud.style} />
        ))}
      </div>

      <div className="relative z-10 w-full max-w-5xl">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-4 py-1.5 text-xs font-medium tracking-[0.24em] text-accent uppercase shadow-shadow shadow-md backdrop-blur-sm">
            <span className="h-2 w-2 rounded-full bg-accent" />
            Cloud Code
          </div>
          <h1 className="text-5xl font-semibold tracking-tight text-foreground sm:text-6xl md:text-7xl">
            Calm clouds. Sharp tools.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-foreground-muted sm:text-lg">
            Start a coding session from a quieter, more polished launch pad built to feel like the rest of the app.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-6 lg:grid-cols-[1.05fr_1.35fr]">
          <div className="rounded-2xl border border-border bg-background/88 p-6 shadow-shadow shadow-xl backdrop-blur-sm">
            <div className="mb-6 flex items-center gap-2 text-xs font-medium tracking-[0.24em] text-accent uppercase">
              <span className="h-2 w-2 rounded-full bg-accent" />
              Atmosphere
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-background-secondary/80 p-4">
                <p className="text-sm font-medium text-foreground">
                  Soft motion, not splash-page chaos.
                </p>
                <p className="mt-1 text-sm leading-6 text-foreground-muted">
                  Clouds now drift with layered depth, subtle highlights, and UI-matched contrast.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-background-secondary/80 p-4">
                <p className="text-sm font-medium text-foreground">
                  Interactive without feeling gimmicky.
                </p>
                <p className="mt-1 text-sm leading-6 text-foreground-muted">
                  Pointer movement gently bends the ambient glow instead of overpowering the page.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-background-secondary/80 p-4">
                <p className="text-sm font-medium text-foreground">
                  Same design language as the workspace.
                </p>
                <p className="mt-1 text-sm leading-6 text-foreground-muted">
                  Borders, backgrounds, shadows, and accent color all match the existing shell and form components.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background/92 p-4 shadow-shadow shadow-xl backdrop-blur-sm sm:p-5">
            <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-background-secondary px-4 py-3">
              <div>
                <p className="text-xs font-medium tracking-[0.22em] text-accent uppercase">
                  Launch panel
                </p>
                <p className="mt-1 text-sm text-foreground-muted">
                  {isAuthenticated
                    ? "Pick a repo and start building."
                    : "Sign in first, then launch a session."}
                </p>
              </div>
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
              </div>
            </div>

            {loading ? (
              <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-border bg-background-secondary/70">
                <LoadingSpinner className="h-6 w-6 text-accent" />
              </div>
            ) : isAuthenticated ? (
              <SessionCreationForm />
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-border bg-background-secondary/70 px-6 text-center">
                <div className="max-w-md">
                  <h2 className="text-2xl font-semibold text-foreground">
                    Sign in to open your first cloud session.
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-foreground-muted sm:text-base">
                    Connect GitHub, choose a repository, and the full session form will appear here.
                  </p>
                </div>

                <button
                  onClick={() => void login()}
                  className="mt-6 inline-flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground shadow-shadow shadow-md transition-colors hover:bg-background-secondary"
                >
                  <Image src="/github_logo.svg" alt="GitHub" width={18} height={18} />
                  Sign in with GitHub
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
