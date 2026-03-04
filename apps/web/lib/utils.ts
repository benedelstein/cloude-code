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

  try {
    return new URL(trimmedValue).host;
  } catch {
    return trimmedValue
      .replace(/^(https?|wss?):\/\//, "")
      .replace(/\/+$/, "");
  }
}
