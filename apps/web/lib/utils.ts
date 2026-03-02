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
