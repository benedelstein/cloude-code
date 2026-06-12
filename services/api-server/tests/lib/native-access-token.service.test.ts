import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { NativeAccessTokenService } from "../../src/modules/auth/services/native-access-token.service";
import type { Env } from "../../src/shared/types";

const SIGNING_KEY = "native-access-token-test-signing-key";

const env = {
  WORKER_URL: "https://api.test",
  NATIVE_ACCESS_TOKEN_SIGNING_KEY: SIGNING_KEY,
} as Env;

const user = {
  id: "user-1",
  githubId: 123,
  githubLogin: "octocat",
  githubName: "Octo Cat",
  githubAvatarUrl: "https://avatar.test/octocat.png",
};

function key(secret = SIGNING_KEY): Uint8Array {
  return new TextEncoder().encode(secret);
}

async function signWithOverrides(overrides: {
  issuer?: string;
  audience?: string;
  type?: string;
  secret?: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    sid: "refresh-session-1",
    github_id: user.githubId,
    github_login: user.githubLogin,
    github_name: user.githubName,
    github_avatar_url: user.githubAvatarUrl,
  })
    .setProtectedHeader({ alg: "HS256", typ: overrides.type ?? "at+jwt" })
    .setIssuer(overrides.issuer ?? "https://api.test")
    .setAudience(overrides.audience ?? "cloudecode-api")
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + 15 * 60)
    .setJti("jwt-1")
    .sign(key(overrides.secret));
}

describe("NativeAccessTokenService", () => {
  it("signs and verifies native access tokens", async () => {
    const service = new NativeAccessTokenService(env);
    const token = await service.sign({
      user,
      refreshSessionId: "refresh-session-1",
    });

    const identity = await service.verify(token);

    expect(identity).toEqual({
      refreshSessionId: "refresh-session-1",
      user: {
        id: "user-1",
        githubId: 123,
        githubLogin: "octocat",
        githubName: "Octo Cat",
        githubAvatarUrl: "https://avatar.test/octocat.png",
      },
    });
  });

  it("rejects tokens with the wrong issuer, audience, type, or signature", async () => {
    const service = new NativeAccessTokenService(env);

    await expect(service.verify(await signWithOverrides({
      issuer: "https://other.test",
    }))).resolves.toBeNull();
    await expect(service.verify(await signWithOverrides({
      audience: "other-audience",
    }))).resolves.toBeNull();
    await expect(service.verify(await signWithOverrides({
      type: "JWT",
    }))).resolves.toBeNull();
    await expect(service.verify(await signWithOverrides({
      secret: "other-signing-key",
    }))).resolves.toBeNull();
  });
});
