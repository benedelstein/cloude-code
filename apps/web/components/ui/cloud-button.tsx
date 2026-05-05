"use client";

import Link from "next/link";
import type { ReactNode } from "react";
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
// CSS `d:` transition interpolates point-by-point only when both paths share the
// same sequence of commands, so the rect packs degenerate cubics along its
// straight edges to match the cloud's lobes one-for-one.
// ViewBox is 200x100. Cloud control points reach past the viewBox so each
// segment puffs outward into a billow. The SVG sets overflow:visible so they
// render past the button. Side bumps are kept smaller than top/bottom because
// the side edges are shorter and the lobes look proportionally larger there.
// Perimeter layout (clockwise from top-left): 4 top lobes, 1 TR corner bump,
// 2 right lobes, 1 BR bump, 4 bottom lobes, 1 BL bump, 2 left lobes, 1 TL bump.
const RECT_D =
  "M 20,0 C 33,0 47,0 60,0 C 73,0 87,0 100,0 C 113,0 127,0 140,0 C 153,0 167,0 180,0 C 191,0 200,9 200,20 C 200,30 200,40 200,50 C 200,60 200,70 200,80 C 200,91 191,100 180,100 C 167,100 153,100 140,100 C 127,100 113,100 100,100 C 87,100 73,100 60,100 C 47,100 33,100 20,100 C 9,100 0,91 0,80 C 0,70 0,60 0,50 C 0,40 0,30 0,20 C 0,9 9,0 20,0 Z";
const CLOUD_D =
  "M 20,0 C 30,-13 42,-13 52,-2 C 65,-11 83,-11 96,0 C 115,-23 139,-23 158,-4 C 165,-13 173,-13 180,0 C 198,-2 210,12 200,22 C 212,30 212,47 200,55 C 210,62 210,73 200,80 C 209,90 196,106 175,100 C 162,116 145,116 132,102 C 120,113 104,113 92,100 C 76,118 56,118 40,104 C 34,111 26,111 20,100 C 5,108 -8,90 0,76 C -10,68 -10,58 0,52 C -12,42 -12,30 0,20 C -7,8 4,-7 20,0 Z";

const STYLE = `
.cloud-btn-shape {
  d: path("${RECT_D}");
  transition: d 600ms cubic-bezier(0.34, 1.4, 0.64, 1);
}
.cloud-btn:hover .cloud-btn-shape,
.cloud-btn:focus-visible .cloud-btn-shape {
  d: path("${CLOUD_D}");
}

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

@media (prefers-reduced-motion: reduce) {
  .cloud-btn-shape { transition: none; }
  .cloud-btn:hover .cloud-btn-shape,
  .cloud-btn:focus-visible .cloud-btn-shape { d: path("${RECT_D}"); }
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
      <path className="cloud-btn-shape" />
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

  if (href) {
    return (
      <>
        <style>{STYLE}</style>
        <Link href={href} className={sharedClassName}>
          {content}
        </Link>
      </>
    );
  }

  return (
    <>
      <style>{STYLE}</style>
      <button type="button" className={sharedClassName} disabled={disabled} onClick={onClick}>
        {content}
      </button>
    </>
  );
}
