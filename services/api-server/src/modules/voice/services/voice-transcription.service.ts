import {
  failure,
  success,
  type Result,
  VoiceTranscriptionResponse,
} from "@repo/shared";
import { z } from "zod";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const logger = createLogger("voice-transcription.service.ts");

const OpenAITranscriptionResponse = z.object({
  text: z.string(),
});

export type VoiceTranscriptionError = {
  status: 500 | 502;
  code: "TRANSCRIPTION_NOT_CONFIGURED" | "TRANSCRIPTION_PROVIDER_FAILED";
  message: string;
};

export class VoiceTranscriptionService {
  constructor(
    private readonly env: Env,
    private readonly fetchProvider: typeof fetch = fetch,
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
