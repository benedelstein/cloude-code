import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeHost(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }

  if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmedValue)) {
    return trimmedValue.replace(/^(https?|wss?):\/\//, "").replace(/\/+$/, "");
  }

  try {
    return new URL(trimmedValue).host;
  } catch {
    return trimmedValue
      .replace(/^(https?|wss?):\/\//, "")
      .replace(/\/+$/, "");
  }
}

interface FadeScaleVisibilityOptions {
  hiddenScaleClass?: string;
  durationClass?: string;
  easingClass?: string;
  className?: ClassValue;
}

export function getFadeScaleVisibilityClasses(
  isVisible: boolean,
  {
    hiddenScaleClass = "scale-90",
    durationClass = "duration-200",
    easingClass = "ease-linear",
    className,
  }: FadeScaleVisibilityOptions = {},
) {
  return cn(
    "transition-all",
    durationClass,
    easingClass,
    isVisible
      ? "scale-100 opacity-100"
      : ["pointer-events-none opacity-0", hiddenScaleClass],
    className,
  );
}
