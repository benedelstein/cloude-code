import { describe, expect, it } from "vitest";
import { validateRedirectOrigin } from "../../src/modules/auth/utils/preview-origin.util";
import type { Env } from "../../src/shared/types";

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: "production",
    WEB_ORIGIN: "https://www.mymachines.dev",
    PREVIEW_ORIGIN_ALLOWLIST_REGEX:
      "^https://my-machines-[a-z0-9][a-z0-9-]*-benedelsteins-projects\\.vercel\\.app$",
    ...overrides,
  } as Env;
}

describe("validateRedirectOrigin", () => {
  it("allows the configured web origin without requiring the preview regex", () => {
    const result = validateRedirectOrigin(
      "http://localhost:3000",
      createEnv({
        WEB_ORIGIN: "http://localhost:3000",
        PREVIEW_ORIGIN_ALLOWLIST_REGEX: "",
      }),
    );

    expect(result).toEqual({ ok: true, value: "http://localhost:3000" });
  });

  it("allows matching https preview origins", () => {
    const result = validateRedirectOrigin(
      "https://my-machines-abc-benedelsteins-projects.vercel.app",
      createEnv(),
    );

    expect(result).toEqual({
      ok: true,
      value: "https://my-machines-abc-benedelsteins-projects.vercel.app",
    });
  });

  it("allows localhost origins in development", () => {
    const result = validateRedirectOrigin(
      "http://localhost:3000",
      createEnv({ ENVIRONMENT: "development" }),
    );

    expect(result).toEqual({ ok: true, value: "http://localhost:3000" });
  });

  it("allows loopback IP origins in development", () => {
    expect(
      validateRedirectOrigin(
        "http://127.0.0.1:3000",
        createEnv({ ENVIRONMENT: "development" }),
      ),
    ).toEqual({ ok: true, value: "http://127.0.0.1:3000" });
    expect(
      validateRedirectOrigin(
        "http://[::1]:3000",
        createEnv({ ENVIRONMENT: "development" }),
      ),
    ).toEqual({ ok: true, value: "http://[::1]:3000" });
  });

  it("rejects localhost origins in production unless explicitly configured", () => {
    const result = validateRedirectOrigin("http://localhost:3000", createEnv());

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toBe("Origin must use https: http://localhost:3000");
  });

  it("rejects non-loopback http origins in development", () => {
    const result = validateRedirectOrigin(
      "http://example.com",
      createEnv({ ENVIRONMENT: "development" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toBe("Origin must use https: http://example.com");
  });

  it("rejects paths on local development origins", () => {
    const result = validateRedirectOrigin(
      "http://localhost:3000/callback",
      createEnv({ ENVIRONMENT: "development" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toBe(
      "Origin must not include a path: http://localhost:3000/callback",
    );
  });
});
