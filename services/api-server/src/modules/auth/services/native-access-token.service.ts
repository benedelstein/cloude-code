import { SignJWT, jwtVerify } from "jose";
import type { Env } from "@/shared/types";

const NATIVE_ACCESS_TOKEN_AUDIENCE = "cloudecode-api";
const NATIVE_ACCESS_TOKEN_TYPE = "at+jwt";
const NATIVE_ACCESS_TOKEN_ALGORITHM = "HS256";
const NATIVE_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface NativeAccessTokenIdentity {
  userId: string;
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
    userId: string;
    refreshSessionId: string;
  }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    return await new SignJWT({
      sid: params.refreshSessionId,
    })
      .setProtectedHeader({
        alg: NATIVE_ACCESS_TOKEN_ALGORITHM,
        typ: NATIVE_ACCESS_TOKEN_TYPE,
      })
      .setIssuer(this.issuer())
      .setAudience(NATIVE_ACCESS_TOKEN_AUDIENCE)
      .setSubject(params.userId)
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
      const jwtId = this.readStringClaim(payload.jti);

      if (
        !refreshSessionId
        || !subject
        || !jwtId
      ) {
        return null;
      }

      return {
        refreshSessionId,
        userId: subject,
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

}
