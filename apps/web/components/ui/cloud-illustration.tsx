import type { ReactNode } from "react";

// blob. Stretched with preserveAspectRatio="none" so it adapts to the
// illustration box's aspect ratio.
const CLOUD_PATH =
  "M290.245 442.039C297.33 437.08 300.873 434.601 303.139 433.907C305.79 433.094 306.583 433.024 309.336 433.358C311.689 433.643 315.302 435.317 322.53 438.667C342.336 447.845 364.499 452.735 387.797 452.173C468.959 450.214 533.166 382.83 531.207 301.668C530.237 261.461 513.21 225.414 486.406 199.512C478.25 191.631 474.173 187.69 472.994 185.114C471.515 181.882 471.425 181.388 471.669 177.842C471.864 175.015 474.594 169.25 480.053 157.718C485.939 145.286 489.085 131.327 488.73 116.639C487.518 66.396 445.804 26.6489 395.561 27.8616C377.837 28.2894 361.419 33.7573 347.645 42.8616C337.992 49.2417 333.165 52.4318 330.425 53.0284C327.16 53.7392 326.323 53.7124 323.11 52.7937C320.414 52.0227 316.449 49.0201 308.52 43.0148C275.631 18.1064 234.395 3.74352 189.945 4.81641C85.5935 7.33513 3.04183 93.9705 5.56054 198.322C6.56699 240.019 21.0043 278.236 44.6361 308.935C49.6922 315.504 52.2203 318.788 53.0138 320.966C54.0569 323.829 54.0747 323.95 53.8936 326.992C53.7559 329.306 51.7299 334.59 47.678 345.16C44.911 352.378 43.4788 360.245 43.6769 368.452C44.4898 402.131 72.4515 428.775 106.131 427.962C111.274 427.838 116.253 427.081 120.995 425.767C135.879 421.643 143.321 419.581 145.596 419.651C149.299 419.766 148.056 419.473 151.419 421.026C153.486 421.98 158.08 426.121 167.267 434.405C185.406 450.76 209.594 460.475 235.938 459.839C256.163 459.351 274.825 452.83 290.245 442.039Z";

// Three slightly different float animations — translateY ranges, rotations,
// durations, and delays vary so a row of clouds drifts out of phase rather
// than bobbing in lockstep. Disabled under prefers-reduced-motion.
const FLOAT_STYLES = `
  @keyframes cloudFloatA {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50%      { transform: translateY(-14px) rotate(-1deg); }
  }
  @keyframes cloudFloatB {
    0%, 100% { transform: translateY(-6px) rotate(0.6deg); }
    50%      { transform: translateY(10px) rotate(-0.8deg); }
  }
  @keyframes cloudFloatC {
    0%, 100% { transform: translateY(0) rotate(0.5deg); }
    50%      { transform: translateY(-11px) rotate(-1.2deg); }
  }
  .cloud-illustration-float-0 { animation: cloudFloatA 7s ease-in-out infinite; }
  .cloud-illustration-float-1 { animation: cloudFloatB 9s ease-in-out -2s infinite; }
  .cloud-illustration-float-2 { animation: cloudFloatC 8s ease-in-out -4s infinite; }
  @media (prefers-reduced-motion: reduce) {
    [class*="cloud-illustration-float-"] { animation: none; }
  }
`;

// Mounted once per render of the page; multiple <style> tags with the same
// content are harmless (browser deduplicates by content) and React renders
// them inline.
function FloatStylesOnce() {
  return <style>{FLOAT_STYLES}</style>;
}

interface CloudIllustrationProps {
  children: ReactNode;
  flip?: boolean;
  /** Index 0/1/2 selects one of three float animation phases. Higher
   *  indices wrap. Pass `null` to disable floating. */
  floatPhase?: 0 | 1 | 2 | null;
  className?: string;
}

export function CloudIllustration({
  children,
  flip,
  floatPhase = 0,
  className,
}: CloudIllustrationProps) {
  const floatClass =
    floatPhase === null ? "" : `cloud-illustration-float-${floatPhase}`;
  return (
    <div className={`relative aspect-[6/5] w-full max-w-md ${floatClass} ${className ?? ""}`}>
      <FloatStylesOnce />
      <svg
        aria-hidden
        viewBox="0 0 546 475"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        style={{
          filter: "drop-shadow(0 18px 30px rgba(31, 45, 61, 0.10))",
          overflow: "visible",
          transform: flip ? "scaleX(-1)" : undefined,
        }}
      >
        <path
          d={CLOUD_PATH}
          fill="#ffffff"
          stroke="rgba(110, 138, 168, 0.28)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
