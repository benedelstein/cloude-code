"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

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

export function CloudField() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let rafId: number | null = null;
    let targetX = 0.5;
    let targetY = 0.5;
    let currentX = 0.5;
    let currentY = 0.5;

    const tick = () => {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      container.style.setProperty("--mx", currentX.toFixed(4));
      container.style.setProperty("--my", currentY.toFixed(4));
      rafId = requestAnimationFrame(tick);
    };

    const handlePointerMove = (event: PointerEvent) => {
      targetX = event.clientX / window.innerWidth;
      targetY = event.clientY / window.innerHeight;
    };

    const handlePointerLeave = () => {
      targetX = 0.5;
      targetY = 0.5;
    };

    if (!prefersReducedMotion) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerleave", handlePointerLeave);
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ "--mx": "0.5", "--my": "0.5" } as CSSProperties}
    >
      {CLOUDS.map((cloud, index) => (
        <Cloud key={index} {...cloud} />
      ))}
      <BottomBank />
    </div>
  );
}

// Full-width bottom cloud bank: bumpy top stroked, sides + bottom bleed past
// the viewport so no edge strokes are visible.
function BottomBank() {
  // Same parallax magnitude as a depth=1 cloud.
  const px = 60;
  const py = 32;
  return (
    <div
      className="absolute bottom-0"
      style={{
        left: "-5vw",
        width: "110vw",
        transform: `translate(calc((var(--mx) - 0.5) * ${px}px), calc((var(--my) - 0.5) * ${py}px))`,
        willChange: "transform",
      }}
    >
      <svg
        viewBox="0 0 1000 280"
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height: "30vh" }}
      >
        <path
          d="M 0 280 L 0 170 Q 30 140 60 150 Q 90 110 140 130 Q 180 80 220 110 Q 260 60 320 100 Q 360 40 410 90 Q 460 60 510 95 Q 560 30 620 85 Q 670 60 720 90 Q 760 40 820 85 Q 870 60 920 90 Q 970 70 1000 110 L 1000 280 Z"
          fill="#ffffff"
        />
        <path
          d="M 0 170 Q 30 140 60 150 Q 90 110 140 130 Q 180 80 220 110 Q 260 60 320 100 Q 360 40 410 90 Q 460 60 510 95 Q 560 30 620 85 Q 670 60 720 90 Q 760 40 820 85 Q 870 60 920 90 Q 970 70 1000 110"
          fill="none"
          stroke="#6b8aa8"
          strokeWidth={1.2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function Cloud({ x, y, width, depth, variant, flip }: CloudConfig) {
  const px = (depth * 60).toFixed(1);
  const py = (depth * 32).toFixed(1);
  const style: CSSProperties = {
    left: `${x}%`,
    top: `${y}%`,
    width: `${width}vw`,
    transform: `translate(calc((var(--mx) - 0.5) * ${px}px), calc((var(--my) - 0.5) * ${py}px))${flip ? " scaleX(-1)" : ""}`,
    willChange: "transform",
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
  return (
    <svg viewBox="0 0 200 100" preserveAspectRatio="none" className="block h-auto w-full">
      <path
        d={PATHS[variant]}
        fill="#ffffff"
        stroke="#6b8aa8"
        strokeWidth={1.2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
