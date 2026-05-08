"use client";

import { useEffect, useState } from "react";

// Bumpy-top cloud silhouette over a body that fills down to the bottom of the
// viewBox. Top is the visible cloud edge; the body is meant to be masked or
// clipped by the caller. Two density variants so narrow viewports don't end
// up with bumps crammed together.
// Bump heights and spacing are intentionally irregular so the silhouette
// doesn't read as mirrored across the midpoint.
const BANK_FILL_DESKTOP =
  "M 0 280 L 0 170 Q 28 142 58 152 Q 95 105 145 125 Q 180 65 220 110 Q 270 45 320 95 Q 365 30 410 85 Q 455 75 500 90 Q 545 50 595 78 Q 645 30 685 105 Q 745 80 790 115 Q 830 90 870 135 Q 935 115 1000 170 L 1000 280 Z";

const BANK_STROKE_DESKTOP =
  "M 0 170 Q 28 142 58 152 Q 95 105 145 125 Q 180 65 220 110 Q 270 45 320 95 Q 365 30 410 85 Q 455 75 500 90 Q 545 50 595 78 Q 645 30 685 105 Q 745 80 790 115 Q 830 90 870 135 Q 935 115 1000 170";

const BANK_FILL_COMPACT =
  "M 0 280 L 0 170 Q 70 145 175 158 Q 295 95 395 138 Q 490 130 580 142 Q 680 100 815 155 Q 905 158 1000 170 L 1000 280 Z";

const BANK_STROKE_COMPACT =
  "M 0 170 Q 70 145 175 158 Q 295 95 395 138 Q 490 130 580 142 Q 680 100 815 155 Q 905 158 1000 170";

interface CloudBankProps {
  /** Flip vertically — bumpy edge points down instead of up. */
  flip?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Body fill color. Defaults to white. */
  fill?: string;
}

export function CloudBank({ flip, className, style, fill = "#ffffff" }: CloudBankProps) {
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
      <path d={compact ? BANK_FILL_COMPACT : BANK_FILL_DESKTOP} fill={fill} />
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
