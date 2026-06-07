import {
  decodeBase64Url,
  encodeBase64Url,
  type VoiceTranscriptionTokenResponse,
} from "@repo/shared";
import { z } from "zod";
import { createLogger } from "@/shared/logging";

const TOKEN_TYPE = "voice-transcription";
const TOKEN_TTL_MS = 90 * 1000;
export const MAX_VOICE_AUDIO_BYTES = 10 * 1024 * 1024;
const logger = createLogger("voice-transcription-token.service.ts");

const VoiceTranscriptionTokenPayloadSchema = z.object({
  type: z.literal(TOKEN_TYPE),
  userId: z.uuid(),
  exp: z.number().int().positive(),
  jti: z.uuid(),
  maxBytes: z.number().int().positive(),
});

export type VoiceTranscriptionTokenPayload = z.infer<
  typeof VoiceTranscriptionTokenPayloadSchema
>;

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function mintVoiceTranscriptionToken(
  signingSecret: string,
  params: { userId: string },
): Promise<VoiceTranscriptionTokenResponse> {
  const expirationTime = Date.now() + TOKEN_TTL_MS;
  const payload: VoiceTranscriptionTokenPayload = {
    type: TOKEN_TYPE,
    userId: params.userId,
    exp: expirationTime,
    jti: crypto.randomUUID(),
    maxBytes: MAX_VOICE_AUDIO_BYTES,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signingKey = await importSigningKey(signingSecret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", signingKey, payloadBytes),
  );

  return {
    token: `${encodeBase64Url(payloadBytes)}.${encodeBase64Url(signature)}`,
    expiresAt: new Date(expirationTime).toISOString(),
    maxBytes: MAX_VOICE_AUDIO_BYTES,
  };
}

export async function verifyVoiceTranscriptionToken(
  signingSecret: string,
  token: string,
): Promise<VoiceTranscriptionTokenPayload | null> {
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

    const payload = VoiceTranscriptionTokenPayloadSchema.parse(JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ));

    if (payload.exp <= Date.now()) {
      return null;
    }

    return payload;
  } catch (error) {
    logger.error("Error verifying voice transcription token", { error });
    return null;
  }
}
