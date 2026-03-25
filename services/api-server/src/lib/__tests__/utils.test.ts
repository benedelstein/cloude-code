import { describe, expect, it } from "vitest";
import { arrayBufferToBase64 } from "../utils";

describe("arrayBufferToBase64", () => {
  it("converts buffer to base64", () => {
    const buffer = Uint8Array.from([1, 2, 3, 4]).buffer;
    expect(arrayBufferToBase64(buffer)).toBe("AQIDBA==");
  });

  it("handles empty buffer", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
  });

  it("handles larger buffers", () => {
    const bytes = new Uint8Array(100_000);
    bytes.fill(65);
    const encoded = arrayBufferToBase64(bytes.buffer);
    expect(encoded.length).toBeGreaterThan(100_000);
  });
});
