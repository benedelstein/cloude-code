import { decodeBase64Url, encodeBase64Url } from "@repo/shared";
import { z } from "zod";
import { createLogger } from "@/shared/logging";

const TOKEN_TYPE = "user-sessions-websocket";
const TOKEN_TTL_MS = 5 * 60 * 1000;
const logger = createLogger("user-sessions-websocket-token.service.ts");

const UserSessionsWebSocketTokenPayloadSchema = z.object({
  type: z.literal(TOKEN_TYPE),
  userId: z.uuid(),
  exp: z.number().int().positive(),
});

type UserSessionsWebSocketTokenPayload = z.infer<
  typeof UserSessionsWebSocketTokenPayloadSchema
>;

export interface UserSessionsWebSocketToken {
  token: string;
  expiresAt: string;
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function mintUserSessionsWebSocketToken(
  signingSecret: string,
  params: { userId: string },
): Promise<UserSessionsWebSocketToken> {
  const expirationTime = Date.now() + TOKEN_TTL_MS;
  const payload: UserSessionsWebSocketTokenPayload = {
    type: TOKEN_TYPE,
    userId: params.userId,
    exp: expirationTime,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signingKey = await importSigningKey(signingSecret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", signingKey, payloadBytes),
  );

  return {
    token: `${encodeBase64Url(payloadBytes)}.${encodeBase64Url(signature)}`,
    expiresAt: new Date(expirationTime).toISOString(),
  };
}

export async function verifyUserSessionsWebSocketToken(
  signingSecret: string,
  token: string,
): Promise<UserSessionsWebSocketTokenPayload | null> {
  const [encodedPayload, encodedSignature] = token.split(".");

  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  try {
    const payloadBytes = decodeBase64Url(encodedPayload);
    const signatureBytes = decodeBase64Url(encodedSignature);
    const signingKey = await importSigningKey(signingSecret);
    const isValid = await crypto.subtle.verify(
      "HMAC",
      signingKey,
      signatureBytes,
      payloadBytes,
    );

    if (!isValid) {
      return null;
    }

    const payload = UserSessionsWebSocketTokenPayloadSchema.parse(JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ));

    if (payload.exp <= Date.now()) {
      return null;
    }

    return payload;
  } catch (error) {
    logger.error("Error verifying user sessions websocket token", { error });
    return null;
  }
}
