"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type CloudOrb = {
  x: number;
  y: number;
  radius: number;
  phase: number;
  drift: number;
  alpha: number;
  hue: "blue" | "cyan" | "violet" | "peach";
};

const cloudHueColors: Record<CloudOrb["hue"], string> = {
  blue: "107, 167, 213",
  cyan: "64, 196, 220",
  violet: "139, 92, 246",
  peach: "244, 154, 118",
};

const cloudOrbs: CloudOrb[] = [
  { x: 0.1, y: 0.24, radius: 175, phase: 0.2, drift: 0.7, alpha: 0.8, hue: "blue" },
  { x: 0.24, y: 0.16, radius: 220, phase: 1.4, drift: 0.45, alpha: 0.72, hue: "cyan" },
  { x: 0.4, y: 0.3, radius: 260, phase: 2.2, drift: 0.55, alpha: 0.66, hue: "blue" },
  { x: 0.62, y: 0.18, radius: 295, phase: 3.1, drift: 0.35, alpha: 0.6, hue: "violet" },
  { x: 0.78, y: 0.34, radius: 250, phase: 4.4, drift: 0.5, alpha: 0.66, hue: "cyan" },
  { x: 0.92, y: 0.2, radius: 190, phase: 5.2, drift: 0.65, alpha: 0.72, hue: "peach" },
  { x: 0.18, y: 0.68, radius: 270, phase: 2.7, drift: 0.3, alpha: 0.56, hue: "violet" },
  { x: 0.5, y: 0.76, radius: 340, phase: 0.8, drift: 0.28, alpha: 0.52, hue: "blue" },
  { x: 0.82, y: 0.72, radius: 280, phase: 1.9, drift: 0.38, alpha: 0.58, hue: "cyan" },
];

const proofPoints = [
  {
    eyebrow: "Cloud computer",
    title: "Agents get a real developer workstation.",
    body: "Each agent works inside its own Linux machine in the cloud. It can edit files, install tools, run tests, open local servers, inspect the app, and keep going until the work is verified.",
  },
  {
    eyebrow: "Multi provider",
    title: "Bring the model subscription you already use.",
    body: "Connect Claude or Codex and route work through the provider that fits the task. The platform handles the computer, repository, session state, and handoff.",
  },
  {
    eyebrow: "Autonomous delivery",
    title: "From first commit to review response.",
    body: "Agents create PRs, react to comments, refine their implementation, and keep the feedback loop moving like another engineer on the team.",
  },
];

function MorphingCloudBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef({ x: 0.5, y: 0.32, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return;
    }

    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let pixelRatio = 1;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const updatePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
        active: true,
      };
    };

    const clearPointer = () => {
      pointerRef.current.active = false;
    };

    const drawRibbon = (time: number) => {
      const gradient = context.createLinearGradient(width * 0.12, 0, width * 0.9, height);
      gradient.addColorStop(0, "rgba(107, 167, 213, 0)");
      gradient.addColorStop(0.3, "rgba(107, 167, 213, 0.22)");
      gradient.addColorStop(0.64, "rgba(139, 92, 246, 0.14)");
      gradient.addColorStop(1, "rgba(107, 167, 213, 0)");

      context.strokeStyle = gradient;
      context.lineWidth = Math.max(80, width * 0.07);
      context.lineCap = "round";
      context.beginPath();

      for (let index = 0; index <= 120; index += 1) {
        const progress = index / 120;
        const x = progress * width;
        const y =
          height * 0.32 +
          Math.sin(progress * Math.PI * 2 + time * 0.38) * 68 +
          Math.cos(progress * Math.PI * 5 - time * 0.24) * 28;

        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.stroke();
    };

    const drawOrb = (orb: CloudOrb, time: number) => {
      const pointer = pointerRef.current;
      const hueColor = cloudHueColors[orb.hue];
      const centerX = orb.x * width + Math.sin(time * orb.drift + orb.phase) * 32;
      const centerY = orb.y * height + Math.cos(time * orb.drift * 0.8 + orb.phase) * 24;
      const pointerX = pointer.x * width;
      const pointerY = pointer.y * height;
      const distance = Math.hypot(centerX - pointerX, centerY - pointerY);
      const pull = pointer.active ? Math.max(0, 1 - distance / 560) : 0;
      const pullAngle = Math.atan2(pointerY - centerY, pointerX - centerX);
      const x = centerX + Math.cos(pullAngle) * pull * 74;
      const y = centerY + Math.sin(pullAngle) * pull * 52;
      const radius = orb.radius * (1 + pull * 0.36);
      const gradient = context.createRadialGradient(x, y, radius * 0.08, x, y, radius);

      gradient.addColorStop(0, `rgba(255, 255, 255, ${orb.alpha + pull * 0.26})`);
      gradient.addColorStop(0.36, `rgba(235, 244, 251, ${orb.alpha * 0.88})`);
      gradient.addColorStop(0.76, `rgba(${hueColor}, ${0.28 + pull * 0.18})`);
      gradient.addColorStop(1, `rgba(${hueColor}, 0)`);

      context.fillStyle = gradient;
      context.beginPath();

      const points = 18;
      for (let index = 0; index <= points; index += 1) {
        const angle = (index / points) * Math.PI * 2;
        const wobble =
          1 +
          Math.sin(angle * 3 + time * 1.7 + orb.phase) * 0.11 +
          Math.cos(angle * 5 - time * 1.1) * 0.07 +
          pull * Math.cos(angle - pullAngle) * 0.38;
        const pointX = x + Math.cos(angle) * radius * wobble * 1.18;
        const pointY = y + Math.sin(angle) * radius * wobble * 0.66;

        if (index === 0) {
          context.moveTo(pointX, pointY);
        } else {
          context.lineTo(pointX, pointY);
        }
      }

      context.closePath();
      context.fill();

      if (pull > 0) {
        const wake = context.createRadialGradient(pointerX, pointerY, 8, pointerX, pointerY, 260);
        wake.addColorStop(0, `rgba(${hueColor}, ${0.2 * pull})`);
        wake.addColorStop(1, `rgba(${hueColor}, 0)`);
        context.fillStyle = wake;
        context.beginPath();
        context.arc(pointerX, pointerY, 260, 0, Math.PI * 2);
        context.fill();
      }
    };

    const draw = (timeStamp: number) => {
      const time = timeStamp / 1000;
      context.clearRect(0, 0, width, height);

      const skyGradient = context.createLinearGradient(0, 0, width, height);
      skyGradient.addColorStop(0, "#eef7fd");
      skyGradient.addColorStop(0.42, "#f8fafc");
      skyGradient.addColorStop(1, "#ffffff");
      context.fillStyle = skyGradient;
      context.fillRect(0, 0, width, height);

      context.globalCompositeOperation = "source-over";
      context.filter = "blur(24px)";
      drawRibbon(reducedMotion ? 0 : time);
      context.filter = "blur(12px)";
      cloudOrbs.forEach((orb) => drawOrb(orb, reducedMotion ? 0 : time));
      context.filter = "none";

      if (pointerRef.current.active) {
        const pointerX = width * pointerRef.current.x;
        const pointerY = height * pointerRef.current.y;
        const glow = context.createRadialGradient(
          pointerX,
          pointerY,
          16,
          pointerX,
          pointerY,
          420,
        );
        glow.addColorStop(0, "rgba(107, 167, 213, 0.34)");
        glow.addColorStop(0.34, "rgba(64, 196, 220, 0.16)");
        glow.addColorStop(1, "rgba(107, 167, 213, 0)");
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);
      }

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
    window.addEventListener("pointerleave", clearPointer);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("pointerleave", clearPointer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    />
  );
}

export function LandingPageClient() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <section className="relative isolate min-h-screen">
        <MorphingCloudBackground />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(255,255,255,0.58),rgba(255,255,255,0.2)_38%,rgba(255,255,255,0)_68%)]" />
        <div className="absolute left-[7%] top-[22%] h-40 w-72 rounded-[999px] border border-white/55 bg-white/18 shadow-[0_30px_100px_rgba(107,167,213,0.18)] backdrop-blur-sm" />
        <div className="absolute right-[10%] top-[34%] h-36 w-64 rounded-[999px] border border-white/50 bg-white/14 shadow-[0_30px_100px_rgba(107,167,213,0.16)] backdrop-blur-sm" />
        <div className="absolute inset-x-6 top-6 z-20">
          <header className="mx-auto flex max-w-6xl items-center justify-between rounded-full border border-white/70 bg-white/58 px-4 py-3 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
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

        <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 pb-20 pt-32">
          <div className="max-w-4xl">
            <p className="mb-6 inline-flex rounded-full border border-accent/30 bg-white/70 px-4 py-2 text-sm font-semibold text-[#28516d] shadow-[0_14px_50px_rgba(107,167,213,0.18)] backdrop-blur-lg">
              Cloud workstations for serious agents
            </p>
            <h1 className="max-w-5xl text-balance text-7xl font-semibold tracking-[-0.08em] text-foreground sm:text-8xl lg:text-[10rem]">
              Cloude Code
            </h1>
            <p className="mt-8 max-w-2xl text-pretty text-xl leading-8 text-[#3f5f73] sm:text-2xl sm:leading-9">
              Give agents a full cloud development environment. They code,
              test, verify the app, and ship PRs autonomously.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="group rounded-full bg-foreground px-7 py-4 text-center text-sm font-semibold text-white shadow-[0_24px_70px_rgba(15,23,42,0.2)] transition hover:-translate-y-1 hover:bg-accent"
              >
                Start a session
                <span className="ml-2 inline-block transition group-hover:translate-x-1">
                  →
                </span>
              </Link>
              <a
                href="#how-it-works"
                className="rounded-full border border-white/70 bg-white/58 px-7 py-4 text-center text-sm font-semibold text-foreground shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl transition hover:-translate-y-1 hover:border-accent"
              >
                See how it works
              </a>
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="relative bg-background px-6 py-28 sm:py-32"
      >
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_1fr_1.16fr]">
          {proofPoints.map((point) => (
            <article
              key={point.title}
              className="group rounded-[2rem] border border-border bg-background-secondary/70 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.06)] transition hover:-translate-y-2 hover:border-accent/40 hover:bg-white last:border-accent/40 last:bg-accent-subtle/70 last:shadow-[0_30px_100px_rgba(107,167,213,0.18)]"
            >
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">
                {point.eyebrow}
              </p>
              <h2 className="mt-6 text-3xl font-semibold tracking-[-0.04em] text-foreground">
                {point.title}
              </h2>
              <p className="mt-5 text-base leading-8 text-foreground-muted">
                {point.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="relative px-6 pb-24">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] border border-accent/20 bg-[linear-gradient(135deg,#0f172a,#28516d_48%,#6ba7d5)] p-8 text-white shadow-[0_40px_120px_rgba(15,23,42,0.26)] sm:p-12">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/70">
                Ready when the agent is
              </p>
              <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
                Hand off the whole development loop.
              </h2>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-white/74">
                Create a session, choose a repo, and let the agent work inside
                its own machine. It opens a PR when the work is ready and keeps
                refining from review.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="justify-self-start rounded-full bg-white px-7 py-4 text-sm font-semibold text-foreground shadow-[0_20px_70px_rgba(255,255,255,0.24)] transition hover:-translate-y-1 hover:bg-accent-subtle lg:justify-self-end"
            >
              Start a session
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
