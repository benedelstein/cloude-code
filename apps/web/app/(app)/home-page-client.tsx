"use client";

import { useMemo, useState } from "react";
import { SessionCreationForm } from "./session-creation-form";

type CloudConfig = {
  id: string;
  width: number;
  height: number;
  top: string;
  left: string;
  durationSeconds: number;
  delaySeconds: number;
  opacity: number;
};

const cloudConfigs: CloudConfig[] = [
  {
    id: "cloud-a",
    width: 320,
    height: 120,
    top: "12%",
    left: "8%",
    durationSeconds: 34,
    delaySeconds: -8,
    opacity: 0.3,
  },
  {
    id: "cloud-b",
    width: 260,
    height: 96,
    top: "22%",
    left: "68%",
    durationSeconds: 28,
    delaySeconds: -18,
    opacity: 0.36,
  },
  {
    id: "cloud-c",
    width: 420,
    height: 140,
    top: "58%",
    left: "72%",
    durationSeconds: 38,
    delaySeconds: -12,
    opacity: 0.24,
  },
  {
    id: "cloud-d",
    width: 290,
    height: 108,
    top: "68%",
    left: "14%",
    durationSeconds: 31,
    delaySeconds: -21,
    opacity: 0.28,
  },
  {
    id: "cloud-e",
    width: 210,
    height: 82,
    top: "44%",
    left: "42%",
    durationSeconds: 26,
    delaySeconds: -4,
    opacity: 0.22,
  },
];

export function HomePageClient() {
  const [pointerPosition, setPointerPosition] = useState({ x: 50, y: 42 });
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
      className="relative isolate flex min-h-full items-center justify-center overflow-hidden bg-[#020817] px-4 py-10"
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) * 100;
        const y = ((event.clientY - bounds.top) / bounds.height) * 100;
        setPointerPosition({ x, y });
      }}
      style={accentStyle}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.22),_transparent_32%),linear-gradient(180deg,_#081225_0%,_#030712_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-80 [background:radial-gradient(circle_at_var(--pointer-x)_var(--pointer-y),rgba(96,165,250,0.3),transparent_18%),radial-gradient(circle_at_20%_20%,rgba(147,197,253,0.14),transparent_24%),radial-gradient(circle_at_80%_30%,rgba(59,130,246,0.18),transparent_20%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:140px_140px] opacity-[0.06]" />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {cloudConfigs.map((cloud) => (
          <div
            key={cloud.id}
            className="cloud-drift absolute"
            style={{
              top: cloud.top,
              left: cloud.left,
              width: `${cloud.width}px`,
              height: `${cloud.height}px`,
              animationDuration: `${cloud.durationSeconds}s`,
              animationDelay: `${cloud.delaySeconds}s`,
              opacity: cloud.opacity,
            }}
          >
            <div className="cloud-shape h-full w-full" />
          </div>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-4xl">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-medium tracking-[0.24em] text-sky-100/90 uppercase backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.85)]" />
            Cloud Code
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-white sm:text-6xl md:text-7xl">
            Drift into your next build.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-sky-100/75 sm:text-lg">
            Pick a repo, drop in a prompt, and launch a coding session inside a living cloudscape.
          </p>
        </div>

        <div className="relative mx-auto mt-10 w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/15 bg-white/10 p-5 shadow-[0_30px_120px_rgba(14,165,233,0.18)] backdrop-blur-2xl sm:p-8">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/60 to-transparent" />
          <div className="pointer-events-none absolute -left-12 top-10 h-32 w-32 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="pointer-events-none absolute -right-8 bottom-6 h-28 w-28 rounded-full bg-blue-500/20 blur-3xl" />

          <div className="relative">
            <div className="mb-6 flex items-center justify-center gap-3 text-sky-50/80">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-300/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/70" />
              </div>
              <span className="text-xs uppercase tracking-[0.3em] text-sky-100/55">
                Start a session
              </span>
            </div>

            <SessionCreationForm />
          </div>
        </div>
      </div>
    </div>
  );
}
