import { SignJWT, jwtVerify } from "jose";
import type { AuthUser } from "../types/auth.types";
import type { Env } from "@/shared/types";

const NATIVE_ACCESS_TOKEN_AUDIENCE = "cloudecode-api";
const NATIVE_ACCESS_TOKEN_TYPE = "at+jwt";
const NATIVE_ACCESS_TOKEN_ALGORITHM = "HS256";
const NATIVE_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface NativeAccessTokenUser {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
}

export interface NativeAccessTokenIdentity {
  user: AuthUser;
  refreshSessionId: string;
}

export function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

export class NativeAccessTokenService {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async sign(params: {
    user: NativeAccessTokenUser;
    refreshSessionId: string;
  }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    return await new SignJWT({
      sid: params.refreshSessionId,
      github_id: params.user.githubId,
      github_login: params.user.githubLogin,
      github_name: params.user.githubName,
      github_avatar_url: params.user.githubAvatarUrl,
    })
      .setProtectedHeader({
        alg: NATIVE_ACCESS_TOKEN_ALGORITHM,
        typ: NATIVE_ACCESS_TOKEN_TYPE,
      })
      .setIssuer(this.issuer())
      .setAudience(NATIVE_ACCESS_TOKEN_AUDIENCE)
      .setSubject(params.user.id)
      .setIssuedAt(now)
      .setExpirationTime(now + NATIVE_ACCESS_TOKEN_TTL_SECONDS)
      .setJti(crypto.randomUUID())
      .sign(this.signingKey());
  }

  async verify(token: string): Promise<NativeAccessTokenIdentity | null> {
    try {
      const { payload, protectedHeader } = await jwtVerify(
        token,
        this.signingKey(),
        {
          issuer: this.issuer(),
          audience: NATIVE_ACCESS_TOKEN_AUDIENCE,
          algorithms: [NATIVE_ACCESS_TOKEN_ALGORITHM],
        },
      );

      if (protectedHeader.typ !== NATIVE_ACCESS_TOKEN_TYPE) {
        return null;
      }

      const refreshSessionId = this.readStringClaim(payload.sid);
      const subject = this.readStringClaim(payload.sub);
      const githubId = this.readNumberClaim(payload.github_id);
      const githubLogin = this.readStringClaim(payload.github_login);
      const githubName = this.readNullableStringClaim(payload.github_name);
      const githubAvatarUrl = this.readNullableStringClaim(payload.github_avatar_url);
      const jwtId = this.readStringClaim(payload.jti);

      if (
        !refreshSessionId
        || !subject
        || githubId === null
        || !githubLogin
        || githubName === undefined
        || githubAvatarUrl === undefined
        || !jwtId
      ) {
        return null;
      }

      return {
        refreshSessionId,
        user: {
          id: subject,
          githubId,
          githubLogin,
          githubName,
          githubAvatarUrl,
        },
      };
    } catch {
      return null;
    }
  }

  private signingKey(): Uint8Array {
    const key = this.env.NATIVE_ACCESS_TOKEN_SIGNING_KEY;
    if (!key) {
      throw new Error("Missing NATIVE_ACCESS_TOKEN_SIGNING_KEY");
    }
    return new TextEncoder().encode(key);
  }

  private issuer(): string {
    return this.env.WORKER_URL;
  }

  private readStringClaim(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private readNullableStringClaim(value: unknown): string | null | undefined {
    if (value === null) {
      return null;
    }
    return typeof value === "string" ? value : undefined;
  }

  private readNumberClaim(value: unknown): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  }
}
