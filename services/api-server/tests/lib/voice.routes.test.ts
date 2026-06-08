import { describe, expect, it, vi } from "vitest";
import type { MiddlewareHandler } from "hono";
import { failure, success } from "@repo/shared";
import { createVoiceRoutes } from "../../src/modules/voice/routes/voice.routes";
import {
  mintVoiceTranscriptionToken,
  type VoiceTranscriptionService,
} from "../../src/modules/voice/services/voice-transcription.service";
import type { Env } from "../../src/shared/types";
import type { AuthUser } from "../../src/shared/types/auth";

const USER_ID = "123e4567-e89b-12d3-a456-426614174001";
const VOICE_SIGNING_KEY = "voice-signing-secret";

const testUser: AuthUser = {
  id: USER_ID,
  githubId: 123,
  githubLogin: "ben",
  githubName: "Ben",
  githubAvatarUrl: null,
  githubAccessToken: "github-token",
};

type RouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

function createAuthMiddleware(): MiddlewareHandler<RouteEnv> {
  return async (c, next) => {
    if (c.req.header("Authorization") !== "Bearer app-token") {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", testUser);
    await next();
  };
}

function createEnv(): Env {
  return {
    VOICE_TOKEN_SIGNING_KEY: VOICE_SIGNING_KEY,
    OPENAI_API_KEY: "openai-key",
  } as Env;
}

function createRoutes(transcribe = vi.fn(async () => success({ text: "hello" }))) {
  return {
    transcribe,
    routes: createVoiceRoutes({
      authMiddleware: createAuthMiddleware(),
      createVoiceTranscriptionService: vi.fn(() => ({
        transcribe,
      } as unknown as VoiceTranscriptionService)),
    }),
  };
}

async function createVoiceToken(): Promise<string> {
  const minted = await mintVoiceTranscriptionToken(VOICE_SIGNING_KEY, {
    userId: USER_ID,
  });
  return minted.token;
}

async function createUploadRequest(input: {
  token?: string;
  file?: File;
}): Promise<Request> {
  const formData = new FormData();
  if (input.file) {
    formData.append("audio", input.file, input.file.name);
  }

  const headers = new Headers();
  if (input.token) {
    headers.set("Authorization", `Bearer ${input.token}`);
  }

  return new Request("http://test/transcriptions", {
    method: "POST",
    headers,
    body: formData,
  });
}

describe("voice routes", () => {
  it("keeps the token mint route behind auth", async () => {
    const { routes } = createRoutes();

    const rejected = await routes.fetch(
      new Request("http://test/transcriptions/token", { method: "POST" }),
      createEnv(),
    );
    expect(rejected.status).toBe(401);

    const accepted = await routes.fetch(
      new Request("http://test/transcriptions/token", {
        method: "POST",
        headers: { Authorization: "Bearer app-token" },
      }),
      createEnv(),
    );
    const body = await accepted.json() as { token?: string; expiresAt?: string; maxBytes?: number };

    expect(accepted.status).toBe(200);
    expect(body.token).toEqual(expect.any(String));
    expect(body.expiresAt).toMatch(/Z$/u);
    expect(body.maxBytes).toBeGreaterThan(0);
  });

  it("rejects uploads with an invalid voice token", async () => {
    const { routes, transcribe } = createRoutes();

    const response = await routes.fetch(
      await createUploadRequest({
        token: "bad-token",
        file: new File(["voice"], "voice.webm", { type: "audio/webm" }),
      }),
      createEnv(),
    );

    expect(response.status).toBe(401);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects uploads with a missing file", async () => {
    const { routes, transcribe } = createRoutes();

    const response = await routes.fetch(
      await createUploadRequest({ token: await createVoiceToken() }),
      createEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Audio file is required" });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects oversized uploads", async () => {
    const { routes, transcribe } = createRoutes();
    const oversizedAudio = new File(
      [new Uint8Array((10 * 1024 * 1024) + 1)],
      "voice.webm",
      { type: "audio/webm" },
    );

    const response = await routes.fetch(
      await createUploadRequest({
        token: await createVoiceToken(),
        file: oversizedAudio,
      }),
      createEnv(),
    );

    expect(response.status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("maps unsupported audio types from the transcription service to a client error", async () => {
    const transcribe = vi.fn(async () => failure({
      status: 400 as const,
      code: "UNSUPPORTED_AUDIO_TYPE" as const,
      message: "Unsupported audio type",
    }));
    const { routes } = createRoutes(transcribe);

    const response = await routes.fetch(
      await createUploadRequest({
        token: await createVoiceToken(),
        file: new File(["voice"], "voice.txt", { type: "text/plain" }),
      }),
      createEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Unsupported audio type" });
    expect(transcribe).toHaveBeenCalledWith({
      audio: expect.any(File),
      userId: USER_ID,
    });
  });

  it("returns transcript text for a valid upload", async () => {
    const { routes, transcribe } = createRoutes();

    const response = await routes.fetch(
      await createUploadRequest({
        token: await createVoiceToken(),
        file: new File(["voice"], "voice.webm", { type: "audio/webm" }),
      }),
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: "hello" });
    expect(transcribe).toHaveBeenCalledWith({
      audio: expect.any(File),
      userId: USER_ID,
    });
  });

  it("accepts valid audio types with codec parameters", async () => {
    const { routes, transcribe } = createRoutes();

    const response = await routes.fetch(
      await createUploadRequest({
        token: await createVoiceToken(),
        file: new File(["voice"], "voice.webm", { type: "audio/webm;codecs=opus" }),
      }),
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: "hello" });
    expect(transcribe).toHaveBeenCalledWith({
      audio: expect.any(File),
      userId: USER_ID,
    });
  });

  it("maps provider failures to client errors", async () => {
    const transcribe = vi.fn(async () => failure({
      status: 502 as const,
      code: "TRANSCRIPTION_PROVIDER_FAILED" as const,
      message: "Transcription provider failed.",
    }));
    const { routes } = createRoutes(transcribe);

    const response = await routes.fetch(
      await createUploadRequest({
        token: await createVoiceToken(),
        file: new File(["voice"], "voice.webm", { type: "audio/webm" }),
      }),
      createEnv(),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Transcription provider failed.",
    });
  });
});
