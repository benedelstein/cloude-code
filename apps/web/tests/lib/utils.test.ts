import { describe, expect, it } from "vitest";
import { getFadeScaleVisibilityClasses, normalizeHost } from "@/lib/utils";

describe("normalizeHost", () => {
  it("extracts the host from URLs", () => {
    expect(normalizeHost(" https://example.com/path?q=1 ")).toBe("example.com");
    expect(normalizeHost("wss://localhost:8787/ws")).toBe("localhost:8787");
  });

  it("normalizes bare hosts without protocols", () => {
    expect(normalizeHost("localhost:8787/")).toBe("localhost:8787");
    expect(normalizeHost("https://api.example.com///")).toBe("api.example.com");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeHost("   ")).toBe("");
  });
});

describe("getFadeScaleVisibilityClasses", () => {
  it("returns visible classes when enabled", () => {
    expect(getFadeScaleVisibilityClasses(true)).toContain("scale-100");
    expect(getFadeScaleVisibilityClasses(true)).toContain("opacity-100");
  });

  it("returns hidden classes when disabled", () => {
    const classes = getFadeScaleVisibilityClasses(false, {
      hiddenScaleClass: "scale-75",
    });

    expect(classes).toContain("pointer-events-none");
    expect(classes).toContain("opacity-0");
    expect(classes).toContain("scale-75");
  });

  it("merges optional classes", () => {
    const classes = getFadeScaleVisibilityClasses(true, {
      durationClass: "duration-500",
      easingClass: "ease-out",
      className: "rounded-md",
    });

    expect(classes).toContain("duration-500");
    expect(classes).toContain("ease-out");
    expect(classes).toContain("rounded-md");
  });
});
