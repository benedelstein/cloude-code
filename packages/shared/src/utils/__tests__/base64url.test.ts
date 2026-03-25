import { describe, expect, it } from "vitest";
import { decodeBase64Url, encodeBase64Url } from "../base64url";

describe("base64url", () => {
  it("roundtrips bytes", () => {
    const input = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = encodeBase64Url(input);
    expect(decodeBase64Url(encoded)).toEqual(input);
  });

  it("handles empty input", () => {
    const encoded = encodeBase64Url(new Uint8Array());
    expect(encoded).toBe("");
    expect(decodeBase64Url(encoded)).toEqual(new Uint8Array());
  });

  it("uses url-safe replacements", () => {
    const encoded = encodeBase64Url(new Uint8Array([251, 255]));
    expect(encoded).toBe("-_8");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });
});
