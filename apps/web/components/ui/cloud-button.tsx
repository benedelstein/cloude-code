"use client";

import Link from "next/link";
import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CloudButtonProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "quiet";
}

// Two paths with identical cubic-bezier command structure (16 C segments + close).
// Because the command structures match exactly, we can interpolate the numeric
// tokens point-by-point at runtime to produce a smooth morph between them.
const RECT_D =
  "M 20,0 C 33,0 47,0 60,0 C 73,0 87,0 100,0 C 113,0 127,0 140,0 C 153,0 167,0 180,0 C 191,0 200,9 200,20 C 200,30 200,40 200,50 C 200,60 200,70 200,80 C 200,91 191,100 180,100 C 167,100 153,100 140,100 C 127,100 113,100 100,100 C 87,100 73,100 60,100 C 47,100 33,100 20,100 C 9,100 0,91 0,80 C 0,70 0,60 0,50 C 0,40 0,30 0,20 C 0,9 9,0 20,0 Z";
const CLOUD_D =
  "M 20,0 C 30,-13 42,-13 52,-2 C 65,-11 83,-11 96,0 C 115,-23 139,-23 158,-4 C 165,-13 173,-13 180,0 C 198,-2 210,12 200,22 C 212,30 212,47 200,55 C 210,62 210,73 200,80 C 209,90 196,106 175,100 C 162,116 145,116 132,102 C 120,113 104,113 92,100 C 76,118 56,118 40,104 C 34,111 26,111 20,100 C 5,108 -8,90 0,76 C -10,68 -10,58 0,52 C -12,42 -12,30 0,20 C -7,8 4,-7 20,0 Z";

const MORPH_MS = 600;

type Token = { kind: "cmd"; value: string } | { kind: "num"; value: number };

function tokenize(d: string): Token[] {
  const parts = d.split(/[\s,]+/).filter(Boolean);
  return parts.map((p) =>
    /^[A-Za-z]$/.test(p)
      ? { kind: "cmd" as const, value: p }
      : { kind: "num" as const, value: parseFloat(p) },
  );
}

const RECT_TOKENS = tokenize(RECT_D);
const CLOUD_TOKENS = tokenize(CLOUD_D);

// approximation of cubic-bezier(0.34, 1.4, 0.64, 1) — back-out with overshoot
function easeOutBack(t: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function buildPath(fromTokens: Token[], progress: number): string {
  const parts: string[] = [];
  for (let i = 0; i < fromTokens.length; i++) {
    const from = fromTokens[i];
    if (from.kind === "cmd") {
      parts.push(from.value);
      continue;
    }
    const a = RECT_TOKENS[i];
    const b = CLOUD_TOKENS[i];
    if (a.kind !== "num" || b.kind !== "num") continue;
    const v = a.value + (b.value - a.value) * progress;
    parts.push(v.toFixed(3));
  }
  return parts.join(" ");
}

const STYLE = `
.cloud-btn-primary .cloud-btn-shape {
  fill: var(--accent-hover);
  stroke: var(--accent-hover);
  stroke-width: 0;
  filter: drop-shadow(0 12px 22px rgba(91, 160, 217, 0.32));
}

.cloud-btn-quiet .cloud-btn-shape {
  fill: #ffffff;
  stroke: rgba(110, 138, 168, 0.45);
  stroke-width: 1;
}
`;

export function CloudButton({
  children,
  className,
  disabled,
  href,
  onClick,
  variant = "primary",
}: CloudButtonProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const progressRef = useRef(0); // 0 = rect, 1 = cloud
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef(0);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const animateTo = (target: 0 | 1) => {
    targetRef.current = target;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      progressRef.current = target;
      if (pathRef.current) {
        pathRef.current.setAttribute("d", buildPath(RECT_TOKENS, target));
      }
      return;
    }

    const start = progressRef.current;
    const delta = target - start;
    if (delta === 0) return;
    const startTime = performance.now();
    // duration scales with remaining distance so partial reverses feel right
    const duration = MORPH_MS * Math.max(0.4, Math.abs(delta));

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = target === 1 ? easeOutBack(t) : easeOutCubic(t);
      const progress = start + delta * eased;
      progressRef.current = progress;
      if (pathRef.current) {
        pathRef.current.setAttribute("d", buildPath(RECT_TOKENS, progress));
      }
      if (t < 1 && targetRef.current === target) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const sharedClassName = cn(
    "cloud-btn group relative isolate inline-flex shrink-0 items-center justify-center font-semibold transition-transform duration-500 ease-out focus-visible:outline-none disabled:pointer-events-none disabled:opacity-70 hover:-translate-y-0.5",
    variant === "primary" && "cloud-btn-primary",
    variant === "quiet" && "cloud-btn-quiet",
    className,
  );

  const surface = (
    <svg
      aria-hidden
      viewBox="0 0 200 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ overflow: "visible" }}
    >
      <path ref={pathRef} className="cloud-btn-shape" d={RECT_D} />
    </svg>
  );

  const label = (
    <span
      className={cn(
        "relative z-10 inline-flex items-center gap-2",
        variant === "primary" && "text-accent-foreground",
        variant === "quiet" && "text-foreground",
      )}
    >
      {children}
    </span>
  );

  const content = (
    <>
      {surface}
      {label}
    </>
  );

  // Skip morph for touch input. iOS Safari treats hover-style visual changes
  // triggered by pointerenter as a "first-tap reveals hover" interaction and
  // can withhold the synthetic click, requiring a second tap to navigate.
  // Mouse/pen still get the hover morph; touch gets a plain, reliable click.
  const handleHoverEnter = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    animateTo(1);
  };
  const handleHoverLeave = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    animateTo(0);
  };

  const handlers = {
    onPointerEnter: handleHoverEnter,
    onPointerLeave: handleHoverLeave,
    onFocus: () => animateTo(1),
    onBlur: () => animateTo(0),
  };

  if (href) {
    return (
      <>
        <style>{STYLE}</style>
        <Link href={href} className={sharedClassName} {...handlers}>
          {content}
        </Link>
      </>
    );
  }

  return (
    <>
      <style>{STYLE}</style>
      <button
        type="button"
        className={sharedClassName}
        disabled={disabled}
        onClick={onClick}
        {...handlers}
      >
        {content}
      </button>
    </>
  );
}
