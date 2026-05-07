"use client";

import { useEffect, useState } from "react";

// Bumpy-top cloud silhouette over a body that fills down to the bottom of the
// viewBox. Top is the visible cloud edge; the body is meant to be masked or
// clipped by the caller. Two density variants so narrow viewports don't end
// up with bumps crammed together.
const BANK_FILL_DESKTOP =
  "M 0 280 L 0 170 Q 30 140 60 150 Q 90 110 140 130 Q 180 80 220 110 Q 260 60 320 100 Q 360 40 410 90 Q 460 60 500 80 Q 540 60 590 90 Q 640 40 680 100 Q 740 60 780 110 Q 820 80 860 130 Q 910 110 940 150 Q 970 140 1000 170 L 1000 280 Z";

const BANK_STROKE_DESKTOP =
  "M 0 170 Q 30 140 60 150 Q 90 110 140 130 Q 180 80 220 110 Q 260 60 320 100 Q 360 40 410 90 Q 460 60 500 80 Q 540 60 590 90 Q 640 40 680 100 Q 740 60 780 110 Q 820 80 860 130 Q 910 110 940 150 Q 970 140 1000 170";

const BANK_FILL_COMPACT =
  "M 0 280 L 0 170 Q 60 120 140 140 Q 240 60 340 100 Q 440 30 500 80 Q 560 30 660 100 Q 760 60 860 140 Q 940 120 1000 170 L 1000 280 Z";

const BANK_STROKE_COMPACT =
  "M 0 170 Q 60 120 140 140 Q 240 60 340 100 Q 440 30 500 80 Q 560 30 660 100 Q 760 60 860 140 Q 940 120 1000 170";

interface CloudBankProps {
  /** Flip vertically — bumpy edge points down instead of up. */
  flip?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function CloudBank({ flip, className, style }: CloudBankProps) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const update = () => setCompact(window.innerWidth < 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <svg
      viewBox="0 0 1000 280"
      preserveAspectRatio="none"
      className={`block w-full ${className ?? ""}`}
      style={{
        ...style,
        transform: flip ? "scaleY(-1)" : style?.transform,
      }}
    >
      <path d={compact ? BANK_FILL_COMPACT : BANK_FILL_DESKTOP} fill="#ffffff" />
      <path
        d={compact ? BANK_STROKE_COMPACT : BANK_STROKE_DESKTOP}
        fill="none"
        stroke="#6b8aa8"
        strokeWidth={1.2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
