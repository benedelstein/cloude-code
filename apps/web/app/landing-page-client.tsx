"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type Ribbon = {
  y: number;
  width: number;
  drift: number;
  phase: number;
  opacity: number;
};

const cloudRibbons: Ribbon[] = [
  { y: 0.34, width: 110, drift: 0.2, phase: 0.4, opacity: 0.28 },
  { y: 0.43, width: 150, drift: 0.16, phase: 1.7, opacity: 0.24 },
  { y: 0.52, width: 180, drift: 0.12, phase: 3.1, opacity: 0.2 },
  { y: 0.61, width: 135, drift: 0.18, phase: 4.2, opacity: 0.18 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function FluidCloudBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef({
    x: 0.52,
    y: 0.48,
    previousX: 0.52,
    previousY: 0.48,
    force: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 1;
    let height = 1;
    let pixelRatio = 1;
    let animationFrame = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const updatePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pointer = pointerRef.current;
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      const velocity = Math.hypot(x - pointer.x, y - pointer.y);

      pointer.previousX = pointer.x;
      pointer.previousY = pointer.y;
      pointer.x = clamp(x, 0, 1);
      pointer.y = clamp(y, 0, 1);
      pointer.force = clamp(pointer.force + velocity * 8, 0, 1);
    };

    const drawRibbon = (ribbon: Ribbon, time: number) => {
      const pointer = pointerRef.current;
      const gradient = context.createLinearGradient(width * 0.18, 0, width * 0.82, height);

      gradient.addColorStop(0, `rgba(255, 255, 255, ${ribbon.opacity * 0.9})`);
      gradient.addColorStop(0.42, `rgba(235, 244, 251, ${ribbon.opacity})`);
      gradient.addColorStop(0.72, `rgba(107, 167, 213, ${ribbon.opacity * 0.62})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

      context.strokeStyle = gradient;
      context.lineCap = "round";
      context.lineJoin = "round";

      for (let strand = 0; strand < 6; strand += 1) {
        const strandOffset = (strand - 2.5) * ribbon.width * 0.18;
        const strandAlpha = 1 - Math.abs(strand - 2.5) / 4;

        context.globalAlpha = strandAlpha;
        context.lineWidth = ribbon.width * (0.22 + strand * 0.035);
        context.beginPath();

        for (let index = 0; index <= 72; index += 1) {
          const progress = index / 72;
          const x = progress * width;
          const pointerDistance = progress - pointer.x;
          const pointerFalloff = Math.max(
            0,
            1 - Math.hypot(pointerDistance * 1.55, (ribbon.y - pointer.y) * 2.4) / 0.55,
          );
          const ambient =
            Math.sin(progress * Math.PI * 2.4 + time * ribbon.drift + ribbon.phase) *
              ribbon.width *
              0.22 +
            Math.sin(progress * Math.PI * 6.2 - time * ribbon.drift * 1.7 + ribbon.phase) *
              ribbon.width *
              0.08;
          const curl =
            Math.sin(pointerDistance * 18 - time * 2.2 + strand) *
            pointerFalloff *
            pointer.force *
            ribbon.width *
            0.8;
          const drag =
            (pointer.y - pointer.previousY) *
            height *
            pointerFalloff *
            pointer.force *
            0.9;
          const y = ribbon.y * height + strandOffset + ambient + curl + drag;

          if (index === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }

        context.stroke();
      }

      context.globalAlpha = 1;
    };

    const draw = (timeStamp: number) => {
      const time = timeStamp / 1000;
      const pointer = pointerRef.current;
      const sky = context.createLinearGradient(0, 0, width, height);

      sky.addColorStop(0, "#f8fafc");
      sky.addColorStop(0.42, "#ebf4fb");
      sky.addColorStop(1, "#ffffff");
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      context.fillStyle = sky;
      context.fillRect(0, 0, width, height);

      context.globalCompositeOperation = "source-over";
      for (const ribbon of cloudRibbons) {
        drawRibbon(ribbon, reducedMotion ? 0 : time);
      }

      const veil = context.createRadialGradient(
        width * 0.5,
        height * 0.48,
        60,
        width * 0.5,
        height * 0.48,
        Math.max(width, height) * 0.62,
      );
      veil.addColorStop(0, "rgba(255, 255, 255, 0.12)");
      veil.addColorStop(0.62, "rgba(255, 255, 255, 0.48)");
      veil.addColorStop(1, "rgba(255, 255, 255, 0.9)");
      context.fillStyle = veil;
      context.fillRect(0, 0, width, height);

      pointer.force *= 0.94;

      if (!reducedMotion) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    resize();
    draw(0);

    if (!reducedMotion) {
      animationFrame = requestAnimationFrame(draw);
    }

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", updatePointer, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", updatePointer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full touch-none"
    />
  );
}

export function LandingPageClient() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground select-none">
      <section className="relative isolate min-h-screen">
        <FluidCloudBackground />

        <header className="absolute right-4 top-5 z-20 sm:right-6 sm:top-6">
          <Link
            href="/dashboard"
            className="rounded-full border border-border bg-white/76 px-5 py-3 text-sm font-semibold text-foreground shadow-[0_16px_60px_rgba(15,23,42,0.1)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-accent hover:text-accent"
          >
            Log in
          </Link>
        </header>

        <div className="pointer-events-none relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-start justify-center px-6 pb-8 pt-24 sm:items-center sm:pb-20 sm:pt-36 sm:text-center">
          <h1 className="max-w-5xl text-balance text-[4rem] font-semibold leading-[0.82] tracking-[-0.085em] text-foreground sm:text-8xl lg:text-[10rem]">
            Cloude Code
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-6 text-[#3f5f73] sm:mt-8 sm:text-2xl sm:leading-9">
            Agents get a full cloud computer to code, test, verify the app, and
            ship PRs autonomously.
          </p>
          <div className="mt-7 flex w-full sm:mt-10 sm:w-auto">
            <Link
              href="/dashboard"
              className="pointer-events-auto w-full rounded-full bg-foreground px-10 py-4 text-center text-sm font-semibold text-white shadow-[0_24px_70px_rgba(15,23,42,0.2)] transition hover:-translate-y-1 hover:bg-accent sm:w-auto"
            >
              Get started
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
