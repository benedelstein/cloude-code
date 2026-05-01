"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type WispParticle = {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  velocityX: number;
  velocityY: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
};

const particleCount = 720;
const cloudHue = 202;

function wrap(value: number, max: number): number {
  if (value < 0) {
    return value + max;
  }
  if (value > max) {
    return value - max;
  }
  return value;
}

function noise(x: number, y: number, time: number): number {
  return (
    Math.sin(x * 0.007 + time * 0.55) +
    Math.sin(y * 0.009 - time * 0.42) +
    Math.sin((x + y) * 0.004 + time * 0.31)
  );
}

function WispyCloudBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef({
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    active: false,
    dragging: false,
    velocityX: 0,
    velocityY: 0,
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
    const particles: WispParticle[] = [];
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let animationFrame = 0;

    const resetParticle = (particle: WispParticle, nearPointer = false) => {
      const pointer = pointerRef.current;
      const cloudCenterX = width * 0.52;
      const cloudCenterY = height * 0.48;
      const spreadX = width * 0.46;
      const spreadY = Math.max(150, height * 0.22);
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random());

      particle.x =
        nearPointer && pointer.active
          ? pointer.x + (Math.random() - 0.5) * 260
          : cloudCenterX + Math.cos(angle) * spreadX * radius;
      particle.y =
        nearPointer && pointer.active
          ? pointer.y + (Math.random() - 0.5) * 180
          : cloudCenterY + Math.sin(angle) * spreadY * radius;
      particle.previousX = particle.x;
      particle.previousY = particle.y;
      particle.velocityX = (Math.random() - 0.5) * 0.18;
      particle.velocityY = (Math.random() - 0.5) * 0.12;
      particle.maxLife = 300 + Math.random() * 340;
      particle.life = particle.maxLife * Math.random();
      particle.size = 1.2 + Math.random() * 3.8;
      particle.hue = cloudHue + (Math.random() - 0.5) * 18;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      particles.length = 0;

      for (let index = 0; index < particleCount; index += 1) {
        const particle = {} as WispParticle;
        resetParticle(particle);
        particles.push(particle);
      }
    };

    const updatePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pointer = pointerRef.current;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      pointer.velocityX = x - pointer.x;
      pointer.velocityY = y - pointer.y;
      pointer.previousX = pointer.x;
      pointer.previousY = pointer.y;
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
    };

    const startDrag = (event: PointerEvent) => {
      updatePointer(event);
      pointerRef.current.dragging = true;
    };

    const stopDrag = () => {
      pointerRef.current.dragging = false;
    };

    const clearPointer = () => {
      pointerRef.current.active = false;
      pointerRef.current.dragging = false;
    };

    const drawMistGlow = (time: number) => {
      const mist = context.createRadialGradient(
        width * 0.52,
        height * 0.48,
        40,
        width * 0.52,
        height * 0.48,
        Math.max(width, height) * 0.46,
      );

      mist.addColorStop(0, "rgba(255, 255, 255, 0.68)");
      mist.addColorStop(0.34, "rgba(235, 244, 251, 0.36)");
      mist.addColorStop(0.66, "rgba(107, 167, 213, 0.12)");
      mist.addColorStop(1, "rgba(107, 167, 213, 0)");
      context.fillStyle = mist;
      context.fillRect(0, 0, width, height);

      context.strokeStyle = "rgba(255, 255, 255, 0.24)";
      context.lineWidth = Math.max(36, width * 0.035);
      context.lineCap = "round";
      context.beginPath();

      for (let index = 0; index <= 90; index += 1) {
        const progress = index / 90;
        const x = width * (0.12 + progress * 0.78);
        const y =
          height * 0.48 +
          Math.sin(progress * Math.PI * 2.2 + time * 0.24) * height * 0.055;

        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.stroke();
    };

    const draw = (timeStamp: number) => {
      const time = timeStamp / 1000;
      const pointer = pointerRef.current;

      context.globalCompositeOperation = "source-over";
      context.fillStyle = "rgba(248, 250, 252, 0.16)";
      context.fillRect(0, 0, width, height);
      drawMistGlow(time);

      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";

      for (const particle of particles) {
        particle.previousX = particle.x;
        particle.previousY = particle.y;

        const field = noise(particle.x, particle.y, time);
        const angle = field * Math.PI * 0.72;
        particle.velocityX += Math.cos(angle) * 0.035;
        particle.velocityY += Math.sin(angle) * 0.035;

        if (pointer.active) {
          const deltaX = particle.x - pointer.x;
          const deltaY = particle.y - pointer.y;
          const distance = Math.hypot(deltaX, deltaY);
          const influence = Math.max(0, 1 - distance / (pointer.dragging ? 320 : 220));

          if (influence > 0) {
            const tangent = Math.atan2(deltaY, deltaX) + Math.PI / 2;
            const dragForce = pointer.dragging ? 0.32 : 0.16;
            particle.velocityX += Math.cos(tangent) * influence * dragForce;
            particle.velocityY += Math.sin(tangent) * influence * dragForce;
            particle.velocityX += pointer.velocityX * influence * 0.018;
            particle.velocityY += pointer.velocityY * influence * 0.018;
          }
        }

        particle.velocityX *= 0.985;
        particle.velocityY *= 0.985;
        particle.x = wrap(particle.x + particle.velocityX, width);
        particle.y = wrap(particle.y + particle.velocityY, height);
        particle.life -= 1;

        const age = particle.life / particle.maxLife;
        const alpha = Math.sin(age * Math.PI) * 0.2;
        context.strokeStyle = `hsla(${particle.hue}, 72%, 74%, ${alpha})`;
        context.lineWidth = particle.size;
        context.beginPath();
        context.moveTo(particle.previousX, particle.previousY);
        context.lineTo(particle.x, particle.y);
        context.stroke();

        if (particle.life <= 0) {
          resetParticle(particle, pointer.dragging);
        }
      }

      pointer.velocityX *= 0.78;
      pointer.velocityY *= 0.78;

      if (!reducedMotion) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    resize();
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, width, height);
    draw(0);

    if (!reducedMotion) {
      animationFrame = requestAnimationFrame(draw);
    }

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("pointerdown", startDrag);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    window.addEventListener("pointerleave", clearPointer);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("pointerdown", startDrag);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
      window.removeEventListener("pointerleave", clearPointer);
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
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#f8fafc_0%,#ebf4fb_38%,#ffffff_72%)]" />
        <WispyCloudBackground />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,255,255,0.18),rgba(255,255,255,0.74)_64%,rgba(255,255,255,0.92)_100%)]" />

        <div className="absolute inset-x-4 top-5 z-20 sm:inset-x-6 sm:top-6">
          <header className="mx-auto flex max-w-6xl items-center justify-between rounded-full border border-white/80 bg-white/70 px-4 py-3 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <Link href="/" className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-accent shadow-[0_0_28px_rgba(107,167,213,0.85)]" />
              <span className="text-sm font-semibold tracking-[0.28em] text-foreground">
                CLOUDE
              </span>
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:border-accent hover:text-accent"
            >
              Log in / dashboard
            </Link>
          </header>
        </div>

        <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-start justify-center px-6 pb-16 pt-24 sm:items-center sm:pb-20 sm:pt-36 sm:text-center">
          <p className="mb-6 inline-flex rounded-full border border-accent/25 bg-white/72 px-4 py-2 text-sm font-semibold text-[#28516d] shadow-[0_14px_50px_rgba(107,167,213,0.16)] backdrop-blur-lg">
            Drag the cloud
          </p>
          <h1 className="max-w-5xl text-balance text-7xl font-semibold tracking-[-0.085em] text-foreground sm:text-8xl lg:text-[10rem]">
            Cloude Code
          </h1>
          <p className="mt-8 max-w-2xl text-pretty text-xl leading-8 text-[#3f5f73] sm:text-2xl sm:leading-9">
            Agents get a full cloud computer to code, test, verify the app, and
            ship PRs autonomously.
          </p>
          <div className="mt-10 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link
              href="/dashboard"
              className="group rounded-full bg-foreground px-8 py-4 text-center text-sm font-semibold text-white shadow-[0_24px_70px_rgba(15,23,42,0.2)] transition hover:-translate-y-1 hover:bg-accent"
            >
              Start a session
              <span className="ml-2 inline-block transition group-hover:translate-x-1">
                →
              </span>
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-white/80 bg-white/66 px-8 py-4 text-center text-sm font-semibold text-foreground shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl transition hover:-translate-y-1 hover:border-accent"
            >
              View dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
