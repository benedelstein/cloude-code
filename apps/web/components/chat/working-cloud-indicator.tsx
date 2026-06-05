const WORKING_CLOUD_STYLES = `
  @keyframes workingCloudFloat {
    0%, 100% { transform: translateY(2px) rotate(-0.35deg) scale(0.995); }
    46% { transform: translateY(-5px) rotate(0.55deg) scale(1.025); }
    72% { transform: translateY(-3px) rotate(0.15deg) scale(1.01); }
  }

  @keyframes workingCloudSquiggle {
    0%, 100% { transform: translateY(0.3px); opacity: 0.48; }
    50% { transform: translateY(-1.2px); opacity: 0.9; }
  }

  .working-cloud-float {
    animation: workingCloudFloat 2.4s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  .working-cloud-outline { shape-rendering: geometricPrecision; }
  .working-cloud-squiggle { animation: workingCloudSquiggle 1.8s ease-in-out infinite; }

  @media (prefers-reduced-motion: reduce) {
    .working-cloud-float,
    .working-cloud-squiggle {
      animation: none;
    }
  }
`;

interface WorkingCloudIndicatorProps {
  className?: string;
  animated?: boolean;
}

export function WorkingCloudIndicator({ className = "", animated = true }: WorkingCloudIndicatorProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-[26px] w-[38px] shrink-0 items-center justify-center text-foreground-secondary ${className}`}
    >
      <style>{WORKING_CLOUD_STYLES}</style>
      <svg
        viewBox="0 0 64 44"
        className="h-[26px] w-[38px] overflow-visible"
        fill="none"
        focusable="false"
      >
        <g className={animated ? "working-cloud-float" : undefined}>
          <path
            d="M12.4 30.1C7.4 29.3 4.9 24.1 8.4 20.5C7.2 16.3 11.3 12.4 16 13.4C18.2 8.2 25.2 7 30 10.6C34.2 7.4 41.2 8.8 43.5 13.6C49.2 13.8 55.4 18.3 54.1 25.3C59.8 30.6 54.1 38.3 45.5 36.8C42 41 35.1 40.8 31.4 37.6C26.9 41.2 19.5 40.4 17.2 35.8C13.6 36.2 10.7 34 12.4 30.1Z"
            fill="var(--background)"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="working-cloud-outline"
          >
            {animated && (
              <animate
                attributeName="d"
                dur="2.8s"
                repeatCount="indefinite"
                values="M12.4 30.1C7.4 29.3 4.9 24.1 8.4 20.5C7.2 16.3 11.3 12.4 16 13.4C18.2 8.2 25.2 7 30 10.6C34.2 7.4 41.2 8.8 43.5 13.6C49.2 13.8 55.4 18.3 54.1 25.3C59.8 30.6 54.1 38.3 45.5 36.8C42 41 35.1 40.8 31.4 37.6C26.9 41.2 19.5 40.4 17.2 35.8C13.6 36.2 10.7 34 12.4 30.1Z;M11.6 29.2C6.8 27.9 5.3 22.3 9 19.5C8.5 15.2 12.8 11.7 17.1 13.2C20 8.7 26.8 7.6 30.8 11.1C35.7 8 41.6 9.6 44.1 14.4C50.8 14 55.6 19.9 53 25.9C59.1 31.7 52.2 38.4 44.7 36.2C40.5 40.2 34.5 39.8 31 36.8C26.1 40.7 19.6 39.4 16.8 35.2C12.8 35.8 9.9 33.1 11.6 29.2Z;M13 30.7C7.7 30 5 24.6 8.8 20.4C7.8 15.7 12.4 12.3 16.8 13.9C19 8.6 26.9 7.4 30.4 11.4C34.8 7.9 41.9 9.7 43 14.5C49.4 14.2 55.8 19 53.3 26.1C58.4 31.2 53.4 38.7 45.4 37.3C42 41.4 34.7 40.4 31.6 37.2C26.5 40.9 20.6 40.9 17.4 35.7C13.8 36.4 11.1 34.5 13 30.7Z;M12.4 30.1C7.4 29.3 4.9 24.1 8.4 20.5C7.2 16.3 11.3 12.4 16 13.4C18.2 8.2 25.2 7 30 10.6C34.2 7.4 41.2 8.8 43.5 13.6C49.2 13.8 55.4 18.3 54.1 25.3C59.8 30.6 54.1 38.3 45.5 36.8C42 41 35.1 40.8 31.4 37.6C26.9 41.2 19.5 40.4 17.2 35.8C13.6 36.2 10.7 34 12.4 30.1Z"
              />
            )}
          </path>
          <path
            d="M19.2 25.6C17.2 27.8 17 30.2 18.9 32.1"
            stroke="currentColor"
            strokeWidth="1.55"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={animated ? "working-cloud-squiggle" : undefined}
          />
          <path
            d="M27.7 29.7C30.4 33.1 35.6 33.1 38.2 29.9"
            stroke="currentColor"
            strokeWidth="1.55"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={animated ? "working-cloud-squiggle" : undefined}
          />
          <path
            d="M43.6 17.4C46.5 17.6 48.3 19 48.9 21.4"
            stroke="currentColor"
            strokeWidth="1.55"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={animated ? "working-cloud-squiggle" : undefined}
          />
        </g>
      </svg>
    </span>
  );
}

export function WorkingCloudRow() {
  return (
    <div className="py-0.5">
      <WorkingCloudIndicator />
    </div>
  );
}
