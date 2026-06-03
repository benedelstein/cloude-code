export function consumeLines(
  buffer: string,
  chunk: string,
): { lines: string[]; remainder: string } {
  const parts = `${buffer}${chunk}`.split("\n");
  return {
    lines: parts.slice(0, -1),
    remainder: parts.at(-1) ?? "",
  };
}

export async function hashScript(script: string): Promise<string | null> {
  return await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(script))
    .then((buf) =>
      Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    );
}
