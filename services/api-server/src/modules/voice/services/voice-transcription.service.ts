import {
  decodeBase64Url,
  encodeBase64Url,
  failure,
  success,
  type Result,
  VoiceTranscriptionResponse,
  type VoiceTranscriptionTokenResponse,
} from "@repo/shared";
import { z } from "zod";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const TOKEN_TYPE = "voice-transcription";
const TOKEN_TTL_MS = 45 * 1000;
export const MAX_VOICE_AUDIO_BYTES = 10 * 1024 * 1024;
const logger = createLogger("voice-transcription.service.ts");

const SUPPORTED_VOICE_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mpga",
  "audio/m4a",
  "audio/wav",
]);

const OpenAITranscriptionResponse = z.object({
  text: z.string(),
});

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

type FetchProvider = typeof fetch;

function defaultFetchProvider(
  input: Parameters<FetchProvider>[0],
  init?: Parameters<FetchProvider>[1],
): ReturnType<FetchProvider> {
  return fetch(input, init);
}

function normalizeMediaType(mediaType: string): string {
  return mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
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

export type VoiceTranscriptionError =
  | {
    status: 400;
    code: "UNSUPPORTED_AUDIO_TYPE";
    message: string;
  }
  | {
    status: 500;
    code: "TRANSCRIPTION_NOT_CONFIGURED";
    message: string;
  }
  | {
    status: 502;
    code: "TRANSCRIPTION_PROVIDER_FAILED";
    message: string;
  };

export class VoiceTranscriptionService {
  constructor(
    private readonly env: Env,
    private readonly fetchProvider: FetchProvider = defaultFetchProvider,
  ) {}

  /**
   * Transcribes a bounded audio file through the configured speech-to-text provider.
   * @param params.audio - Parsed audio file from the upload request.
   * @param params.userId - Authenticated user id from the voice upload token.
   * @returns Transcript text on success or a stable transcription error.
   */
  async transcribe(params: {
    audio: File;
    userId: string;
  }): Promise<Result<VoiceTranscriptionResponse, VoiceTranscriptionError>> {
    const mediaType = normalizeMediaType(params.audio.type);
    if (!SUPPORTED_VOICE_AUDIO_TYPES.has(mediaType)) {
      return failure({
        status: 400,
        code: "UNSUPPORTED_AUDIO_TYPE",
        message: "Unsupported audio type",
      });
    }

    if (!this.env.OPENAI_API_KEY) {
      logger.error("OpenAI transcription API key is not configured", {
        fields: { userId: params.userId },
      });
      return failure({
        status: 500,
        code: "TRANSCRIPTION_NOT_CONFIGURED",
        message: "Transcription is not configured.",
      });
    }

    const body = new FormData();
    body.append("file", params.audio, params.audio.name || "voice-message.webm");
    body.append(
      "model",
      this.env.OPENAI_TRANSCRIPTION_MODEL ?? DEFAULT_TRANSCRIPTION_MODEL,
    );
    body.append("response_format", "json");

    let response: Response;
    try {
      response = await this.fetchProvider(OPENAI_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}` },
        body,
      });
    } catch (error) {
      logger.error("OpenAI transcription request failed", {
        fields: { userId: params.userId },
        error,
      });
      return failure({
        status: 502,
        code: "TRANSCRIPTION_PROVIDER_FAILED",
        message: "Transcription provider failed.",
      });
    }

    if (!response.ok) {
      logger.warn("OpenAI transcription provider returned non-success status", {
        fields: { userId: params.userId, status: response.status },
      });
      return failure({
        status: 502,
        code: "TRANSCRIPTION_PROVIDER_FAILED",
        message: "Transcription provider failed.",
      });
    }

    let rawPayload: unknown;
    try {
      rawPayload = await response.json();
    } catch (error) {
      logger.error("OpenAI transcription response was not JSON", {
        fields: { userId: params.userId },
        error,
      });
      return failure({
        status: 502,
        code: "TRANSCRIPTION_PROVIDER_FAILED",
        message: "Transcription provider failed.",
      });
    }

    const parsedPayload = OpenAITranscriptionResponse.safeParse(rawPayload);
    if (!parsedPayload.success) {
      logger.error("OpenAI transcription response failed validation", {
        fields: { userId: params.userId },
        error: parsedPayload.error,
      });
      return failure({
        status: 502,
        code: "TRANSCRIPTION_PROVIDER_FAILED",
        message: "Transcription provider failed.",
      });
    }

    return success(VoiceTranscriptionResponse.parse(parsedPayload.data));
  }
}
