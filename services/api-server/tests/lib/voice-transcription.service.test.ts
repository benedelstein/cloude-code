import { describe, expect, it, vi } from "vitest";
import { VoiceTranscriptionService } from "../../src/modules/voice/services/voice-transcription.service";
import type { Env } from "../../src/shared/types";

const USER_ID = "123e4567-e89b-12d3-a456-426614174001";

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    OPENAI_API_KEY: "openai-key",
    ...overrides,
  } as Env;
}

function createAudioFile(): File {
  return new File(["voice"], "voice-message.webm", { type: "audio/webm" });
}

describe("VoiceTranscriptionService", () => {
  it("builds an OpenAI transcription request with the default model", async () => {
    const fetchProvider = vi.fn(async () => new Response(JSON.stringify({
      text: "hello world",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const service = new VoiceTranscriptionService(createEnv(), fetchProvider);

    await expect(service.transcribe({
      audio: createAudioFile(),
      userId: USER_ID,
    })).resolves.toEqual({
      ok: true,
      value: { text: "hello world" },
    });

    const [url, init] = fetchProvider.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ Authorization: "Bearer openai-key" });
    expect(init?.body).toBeInstanceOf(FormData);

    const body = init?.body as FormData;
    expect(body.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(body.get("response_format")).toBe("json");
    expect(body.get("file")).toBeInstanceOf(File);
  });

  it("uses the configured transcription model override", async () => {
    const fetchProvider = vi.fn(async () => new Response(JSON.stringify({
      text: "hello",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const service = new VoiceTranscriptionService(createEnv({
      OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-transcribe",
    }), fetchProvider);

    await service.transcribe({ audio: createAudioFile(), userId: USER_ID });

    const init = fetchProvider.mock.calls[0]?.[1];
    const body = init?.body as FormData;
    expect(body.get("model")).toBe("gpt-4o-transcribe");
  });

  it("returns not configured when the OpenAI key is missing", async () => {
    const fetchProvider = vi.fn();
    const service = new VoiceTranscriptionService(createEnv({
      OPENAI_API_KEY: "",
    }), fetchProvider);

    await expect(service.transcribe({
      audio: createAudioFile(),
      userId: USER_ID,
    })).resolves.toEqual({
      ok: false,
      error: {
        status: 500,
        code: "TRANSCRIPTION_NOT_CONFIGURED",
        message: "Transcription is not configured.",
      },
    });
    expect(fetchProvider).not.toHaveBeenCalled();
  });

  it("maps provider failures to a stable error", async () => {
    const fetchProvider = vi.fn(async () => new Response(JSON.stringify({
      error: "provider details",
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }));
    const service = new VoiceTranscriptionService(createEnv(), fetchProvider);

    await expect(service.transcribe({
      audio: createAudioFile(),
      userId: USER_ID,
    })).resolves.toEqual({
      ok: false,
      error: {
        status: 502,
        code: "TRANSCRIPTION_PROVIDER_FAILED",
        message: "Transcription provider failed.",
      },
    });
  });
});
