"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import { CloudBank } from "./cloud-bank";

// Flat illustration-style clouds with cursor parallax. Each cloud is a single
// bumpy path with a white fill and thin slate-blue stroke.

type CloudConfig = {
  // Position as % of viewport.
  x: number;
  y: number;
  // Width in viewport-width units (vw).
  width: number;
  depth: number; // 0 (far) → 1 (near)
  variant: 0 | 1 | 2;
  flip?: boolean;
};

const CLOUDS: CloudConfig[] = [
  // High wisps — small, far, gentle parallax.
  { x: 4,  y: 6,  width: 14, depth: 0.22, variant: 2 },
  { x: 18, y: 14, width: 22, depth: 0.30, variant: 2, flip: true },
  { x: 32, y: 8,  width: 14, depth: 0.32, variant: 2, flip: true },
  { x: 44, y: 4,  width: 12, depth: 0.20, variant: 2 },
  { x: 56, y: 14, width: 12, depth: 0.26, variant: 2 },
  { x: 70, y: 4,  width: 18, depth: 0.28, variant: 2, flip: true },
  { x: 82, y: 12, width: 24, depth: 0.34, variant: 2 },

  // Mid-tier puffs — varied depth so parallax separates them.
  { x: -8, y: 26, width: 32, depth: 0.50, variant: 0, flip: true },
  { x: 24, y: 22, width: 14, depth: 0.40, variant: 1 },
  { x: 50, y: 26, width: 12, depth: 0.38, variant: 2 },
  { x: 72, y: 32, width: 30, depth: 0.60, variant: 0 },
  { x: 88, y: 22, width: 14, depth: 0.45, variant: 1, flip: true },

  // Lower band — flanking, leave the title region clear.
  { x: -10, y: 50, width: 26, depth: 0.55, variant: 1, flip: true },
  { x: 6,   y: 44, width: 12, depth: 0.40, variant: 2, flip: true },
  { x: 86,  y: 48, width: 22, depth: 0.55, variant: 0 },
  { x: 92,  y: 38, width: 12, depth: 0.42, variant: 2 },
  { x: 80,  y: 64, width: 14, depth: 0.45, variant: 2 },
];

const SETTLE_EPSILON = 0.0005;

export function CloudField() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      return;
    }

    let rafId: number | null = null;
    let targetX = 0.5;
    let targetY = 0.5;
    let currentX = 0.5;
    let currentY = 0.5;
    let visible = true;
    let tabVisible = document.visibilityState === "visible";

    const tick = () => {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      container.style.setProperty("--mx", currentX.toFixed(4));
      container.style.setProperty("--my", currentY.toFixed(4));
      // Stop the loop once settled at the target. pointermove restarts it.
      if (
        Math.abs(targetX - currentX) < SETTLE_EPSILON &&
        Math.abs(targetY - currentY) < SETTLE_EPSILON
      ) {
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (rafId !== null) { return; }
      if (!visible || !tabVisible) { return; }
      rafId = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      targetX = event.clientX / window.innerWidth;
      targetY = event.clientY / window.innerHeight;
      start();
    };

    const handlePointerLeave = () => {
      targetX = 0.5;
      targetY = 0.5;
      start();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerleave", handlePointerLeave);

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) { return; }
        visible = entry.isIntersecting;
        if (visible) { start(); }
        else { stop(); }
      },
      { threshold: 0 },
    );
    observer.observe(container);

    const handleVisibility = () => {
      tabVisible = document.visibilityState === "visible";
      if (tabVisible) { start(); }
      else { stop(); }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
      observer.disconnect();
      stop();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 overflow-x-clip"
      style={{ "--mx": "0.5", "--my": "0.5" } as CSSProperties}
    >
      {CLOUDS.map((cloud, index) => (
        <Cloud key={index} {...cloud} />
      ))}
      <BottomBank />
    </div>
  );
}

// Full-width bottom cloud bank: bumpy top silhouette over a body that fades
// smoothly to transparent toward the bottom. Sides bleed past the viewport
// (clipped by the parent's overflow-x-clip).
function BottomBank() {
  // Same parallax magnitude as a depth=1 cloud. Sign is inverted so that
  // moving the cursor right reveals the right end of the bank.
  const px = 60;
  const py = 32;

  const fadeMask = "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)";

  return (
    <div
      className="absolute z-20"
      style={{
        bottom: "-22vh",
        left: "-5vw",
        width: "110vw",
        transform: `translate(calc((0.5 - var(--mx)) * ${px}px), calc((0.5 - var(--my)) * ${py}px))`,
        willChange: "transform",
        maskImage: fadeMask,
        WebkitMaskImage: fadeMask,
      }}
    >
      <CloudBank style={{ height: "55vh" }} />
    </div>
  );
}

function Cloud({ x, y, width, depth, variant, flip }: CloudConfig) {
  const px = (depth * 60).toFixed(1);
  const py = (depth * 32).toFixed(1);
  // Width in vmax so portrait phones (where vh > vw) get visibly larger
  // clouds rather than shrinking with the narrow viewport.
  const style: CSSProperties = {
    left: `${x}%`,
    top: `${y}%`,
    width: `${width}vmax`,
    transform: `translate(calc((0.5 - var(--mx)) * ${px}px), calc((0.5 - var(--my)) * ${py}px))${flip ? " scaleX(-1)" : ""}`,
  };
  return (
    <div className="absolute" style={style}>
      <CloudShape variant={variant} />
    </div>
  );
}

// Cloud silhouettes. ViewBox 200x100. Wide cumulus with tall central peak;
// the side ends droop below the bump bases for a downturned, sagging shape.
const PATHS: Record<0 | 1 | 2, string> = {
  // 0 — wide cumulus with one tall central peak.
  0: "M 24 70 Q 16 80 38 82 Q 80 88 130 84 Q 168 86 184 80 Q 196 76 190 70 Q 196 58 174 58 Q 158 38 140 50 Q 120 18 96 36 Q 78 26 66 44 Q 50 50 40 60 Q 22 62 24 70 Z",
  // 1 — flatter, right-leaning shoulder.
  1: "M 26 70 Q 20 78 40 80 Q 70 86 100 82 Q 132 84 150 80 Q 164 78 160 72 Q 168 60 144 60 Q 132 36 114 48 Q 96 28 78 40 Q 64 34 54 46 Q 40 52 36 62 Q 24 64 26 70 Z",
  // 2 — small high wisp.
  2: "M 22 64 Q 18 72 34 74 Q 58 78 90 74 Q 116 76 124 70 Q 132 66 124 62 Q 132 52 110 52 Q 96 36 80 44 Q 62 36 54 48 Q 38 52 32 60 Q 20 60 22 64 Z",
};

function CloudShape({ variant }: { variant: 0 | 1 | 2 }) {
  const d = PATHS[variant];
  return (
    <svg viewBox="0 0 200 104" preserveAspectRatio="none" className="block h-auto w-full">
      {/* Flat shadow: same path offset down, translucent dark fill. Cheaper
          than a CSS drop-shadow filter (which forces a paint each parallax
          frame). */}
      <path d={d} transform="translate(0 2)" fill="rgba(31, 45, 61, 0.10)" />
      <path
        d={d}
        fill="#ffffff"
        stroke="#6b8aa8"
        strokeWidth={1.2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
