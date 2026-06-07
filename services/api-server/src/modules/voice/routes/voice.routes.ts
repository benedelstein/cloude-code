import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import type { AuthUser } from "@/shared/types/auth";
import type { VoiceTranscriptionService } from "../services/voice-transcription.service";
import {
  MAX_VOICE_AUDIO_BYTES,
  mintVoiceTranscriptionToken,
  verifyVoiceTranscriptionToken,
} from "../services/voice-transcription-token.service";
import {
  createVoiceTranscriptionTokenRoute,
  transcribeVoiceRoute,
} from "./voice.schema";

type VoiceRouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

export const SUPPORTED_VOICE_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mpga",
  "audio/m4a",
  "audio/wav",
]);

export interface VoiceRouteDeps {
  authMiddleware: MiddlewareHandler<VoiceRouteEnv>;
  createVoiceTranscriptionService(env: Env): VoiceTranscriptionService;
}

function readBearerToken(header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7);
}

function parseContentLength(header: string | null): number | null {
  if (!header) {
    return null;
  }

  const contentLength = Number(header);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return null;
  }

  return contentLength;
}

function isUploadedFile(value: unknown): value is File {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    name?: unknown;
    size?: unknown;
    type?: unknown;
    stream?: unknown;
  };

  return typeof candidate.name === "string"
    && typeof candidate.size === "number"
    && typeof candidate.type === "string"
    && typeof candidate.stream === "function";
}

export function createVoiceRoutes(
  deps: VoiceRouteDeps,
): OpenAPIHono<VoiceRouteEnv> {
  const voiceRoutes = new OpenAPIHono<VoiceRouteEnv>();
  const logger = createLogger("voice.routes.ts");

  voiceRoutes.use("/transcriptions/token", deps.authMiddleware);

  voiceRoutes.openapi(createVoiceTranscriptionTokenRoute, async (c) => {
    const user = c.get("user");
    const token = await mintVoiceTranscriptionToken(
      c.env.VOICE_TOKEN_SIGNING_KEY,
      { userId: user.id },
    );

    return c.json(token, 200);
  });

  voiceRoutes.openapi(transcribeVoiceRoute, async (c) => {
    const token = readBearerToken(c.req.raw.headers.get("Authorization"));
    const tokenPayload = token
      ? await verifyVoiceTranscriptionToken(c.env.VOICE_TOKEN_SIGNING_KEY, token)
      : null;
    if (!tokenPayload) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const maxBytes = Math.min(tokenPayload.maxBytes, MAX_VOICE_AUDIO_BYTES);
    const contentLength = parseContentLength(c.req.raw.headers.get("Content-Length"));
    if (contentLength !== null && contentLength > maxBytes) {
      return c.json({ error: "Audio file too large" }, 413);
    }

    let formData: FormData;
    try {
      formData = await c.req.raw.formData();
    } catch (error) {
      logger.warn("Voice upload form data parse failed", {
        fields: { userId: tokenPayload.userId },
        error,
      });
      return c.json({ error: "Invalid audio upload" }, 400);
    }

    const audio = formData.get("audio");
    if (!isUploadedFile(audio)) {
      return c.json({ error: "Audio file is required" }, 400);
    }
    if (audio.size <= 0) {
      return c.json({ error: "Audio file is empty" }, 400);
    }
    if (audio.size > maxBytes) {
      return c.json({ error: "Audio file too large" }, 413);
    }
    if (!SUPPORTED_VOICE_AUDIO_TYPES.has(audio.type)) {
      return c.json({ error: "Unsupported audio type" }, 400);
    }

    logger.info("Transcribing voice upload", {
      fields: {
        userId: tokenPayload.userId,
        sizeBytes: audio.size,
        mediaType: audio.type,
      },
    });

    const service = deps.createVoiceTranscriptionService(c.env);
    const result = await service.transcribe({
      audio,
      userId: tokenPayload.userId,
    });

    if (!result.ok) {
      switch (result.error.status) {
        case 500:
          return c.json({ error: result.error.message }, 500);
        case 502:
          return c.json({ error: result.error.message }, 502);
        default: {
          const exhaustiveCheck: never = result.error.status;
          throw new Error(`Unhandled voice transcription error: ${exhaustiveCheck}`);
        }
      }
    }

    return c.json(result.value, 200);
  });

  return voiceRoutes;
}
