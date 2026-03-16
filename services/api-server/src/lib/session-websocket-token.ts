import { decodeBase64Url, encodeBase64Url } from "@repo/shared";
import { z } from "zod";

const TOKEN_TYPE = "session-websocket";
const TOKEN_TTL_MS = 5 * 60 * 1000;

const SessionWebSocketTokenPayloadSchema = z.object({
  type: z.literal(TOKEN_TYPE),
  sessionId: z.uuid(),
  userId: z.uuid(),
  exp: z.number().int().positive(),
});

type SessionWebSocketTokenPayload = z.infer<
  typeof SessionWebSocketTokenPayloadSchema
>;

export interface SessionWebSocketToken {
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

export async function mintSessionWebSocketToken(
  signingSecret: string,
  params: { sessionId: string; userId: string },
): Promise<SessionWebSocketToken> {
  const expirationTime = Date.now() + TOKEN_TTL_MS;
  const payload: SessionWebSocketTokenPayload = {
    type: TOKEN_TYPE,
    sessionId: params.sessionId,
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

export async function verifySessionWebSocketToken(
  signingSecret: string,
  token: string,
): Promise<SessionWebSocketTokenPayload | null> {
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

    const payload = SessionWebSocketTokenPayloadSchema.parse(JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ));

    if (payload.exp <= Date.now()) {
      return null;
    }

    return payload;
  } catch (error) {
    console.error("Error verifying session websocket token", error);
    return null;
  }
}
