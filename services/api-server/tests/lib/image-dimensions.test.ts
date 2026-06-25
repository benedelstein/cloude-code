import { describe, expect, it } from "vitest";
import { parseImageDimensions } from "../../src/modules/attachments/utils/image-dimensions";

describe("parseImageDimensions", () => {
  it("reads PNG dimensions from the IHDR header", () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x02, 0x80,
      0x00, 0x00, 0x01, 0xE0,
    ]);

    expect(parseImageDimensions(bytes.buffer, "image/png")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("reads JPEG dimensions from a start-of-frame segment", () => {
    const bytes = new Uint8Array([
      0xFF, 0xD8,
      0xFF, 0xE0,
      0x00, 0x04,
      0x00, 0x00,
      0xFF, 0xC0,
      0x00, 0x11,
      0x08,
      0x01, 0xE0,
      0x02, 0x80,
      0x03,
      0x01, 0x11, 0x00,
      0x02, 0x11, 0x00,
      0x03, 0x11, 0x00,
    ]);

    expect(parseImageDimensions(bytes.buffer, "image/jpeg")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("returns null for unsupported image types", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

    expect(parseImageDimensions(bytes.buffer, "image/svg+xml")).toBeNull();
  });
});
