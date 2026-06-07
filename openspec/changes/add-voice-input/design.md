## Context

The active session composer lives in `apps/web/components/chat/chat-input.tsx`; session creation has a similar composer footer in `apps/web/app/(app)/session-creation-form.tsx`. Both currently send text and image attachments through the existing web/API paths.

The web app's REST calls normally go through `apps/web/app/api/[...path]/route.ts`, which reads request bodies with `await req.arrayBuffer()` before forwarding them to the API server. That proxy path is fine for JSON, but it is the wrong default for multi-minute audio because it adds another full request-body hop and can hit Vercel function request payload limits around a five-minute recording. Direct upload keeps the path to:

```text
Browser -> Cloudflare Worker API -> OpenAI transcriptions
```

instead of:

```text
Browser -> Next.js proxy -> Cloudflare Worker API -> OpenAI transcriptions
```

OpenAI's completed-file transcription endpoint accepts audio uploads and currently supports `gpt-4o-mini-transcribe` and `gpt-4o-transcribe`. Anthropic does not expose a public speech-to-text endpoint suitable for this feature, and the repo's existing Anthropic OAuth/API key paths are for Claude inference, not STT.

## Goals / Non-Goals

**Goals:**

- Let a user record, transcribe, review, and send voice-written chat messages from the existing composer.
- Keep audio upload off the Next.js proxy path.
- Keep provider credentials server-side.
- Bound recording time and upload size so Worker parsing and provider calls remain predictable.
- Preserve audio drafts through transient transcription failures so max-duration auto-stop never loses audio.
- Keep the first implementation completed-file based, not realtime streaming.
- Reuse existing visual patterns, icon set, shared Zod contracts, Hono OpenAPI routes, and token style.

**Non-Goals:**

- Do not store successful voice audio in R2.
- Do not send raw audio to the VM or the agent provider.
- Do not use user Anthropic OAuth, Codex/ChatGPT OAuth, or browser-held OpenAI credentials for STT.
- Do not stream partial transcripts in v1.
- Do not make max-duration auto-stop submit text to the agent without an explicit user send action.
- Do not introduce a new frontend animation dependency.

## Decisions

### Use OpenAI transcription with an app-owned API key

Default model:

```ts
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
```

Server env additions:

```ts
OPENAI_API_KEY: string;
OPENAI_TRANSCRIPTION_MODEL?: string;
VOICE_TOKEN_SIGNING_KEY: string;
```

`gpt-4o-mini-transcribe` is the default because dictation should be low-latency and low-cost. `OPENAI_TRANSCRIPTION_MODEL` lets production switch to `gpt-4o-transcribe` if accuracy on code terms is more important than cost.

Provider call shape:

```ts
const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

const body = new FormData();
body.append("file", audio, audio.name || "voice-message.webm");
body.append("model", env.OPENAI_TRANSCRIPTION_MODEL ?? DEFAULT_TRANSCRIPTION_MODEL);
body.append("response_format", "json");

const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
  body,
});
```

Rationale:

- Anthropic has no matching public STT API for this use case.
- Existing OpenAI Codex device auth in this repo is not OpenAI Platform API auth and should not be repurposed.
- Keeping the Platform key on the Worker preserves the current server-side credential boundary.

### Mint a short-lived voice upload token after recording

The browser should request the voice token only after the recording has stopped and a file exists. That keeps the TTL short without expiring during a five-minute recording.

Shared response schemas:

```ts
export const VoiceTranscriptionTokenResponse = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
  maxBytes: z.number().int().positive(),
});
export type VoiceTranscriptionTokenResponse = z.infer<
  typeof VoiceTranscriptionTokenResponse
>;

export const VoiceTranscriptionResponse = z.object({
  text: z.string(),
});
export type VoiceTranscriptionResponse = z.infer<
  typeof VoiceTranscriptionResponse
>;
```

Token payload:

```ts
const TOKEN_TYPE = "voice-transcription";
const TOKEN_TTL_MS = 45 * 1000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const VoiceTranscriptionTokenPayloadSchema = z.object({
  type: z.literal(TOKEN_TYPE),
  userId: z.uuid(),
  exp: z.number().int().positive(),
  jti: z.uuid(),
  maxBytes: z.number().int().positive(),
});
```

Minting mirrors existing websocket-token services:

```ts
export async function mintVoiceTranscriptionToken(
  signingSecret: string,
  params: { userId: string },
): Promise<VoiceTranscriptionTokenResponse> {
  const expirationTime = Date.now() + TOKEN_TTL_MS;
  const payload = {
    type: TOKEN_TYPE,
    userId: params.userId,
    exp: expirationTime,
    jti: crypto.randomUUID(),
    maxBytes: MAX_AUDIO_BYTES,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signingKey = await importSigningKey(signingSecret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", signingKey, payloadBytes),
  );

  return {
    token: `${encodeBase64Url(payloadBytes)}.${encodeBase64Url(signature)}`,
    expiresAt: new Date(expirationTime).toISOString(),
    maxBytes: MAX_AUDIO_BYTES,
  };
}
```

The token is stateless in v1. Replay inside the 45-second TTL is acceptable because the token is minted only for an already-authenticated user, uses a low byte cap, carries no provider secret, and is useless after expiry. If abuse shows up, add a D1/KV consumed-token table keyed by `jti`; do not add that complexity up front.

### Add a dedicated voice API module

Routes:

```http
POST /voice/transcriptions/token
Authorization: Bearer <normal app session token>
-> { token, expiresAt, maxBytes }

POST /voice/transcriptions
Authorization: Bearer <voice transcription token>
Content-Type: multipart/form-data
audio=<File>
-> { text }
```

OpenAPI route shapes:

```ts
export const createVoiceTranscriptionTokenRoute = createRoute({
  method: "post",
  path: "/transcriptions/token",
  responses: {
    200: {
      content: { "application/json": { schema: VoiceTranscriptionTokenResponse } },
      description: "Voice transcription upload token",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Authentication required",
    },
  },
});

export const transcribeVoiceRoute = createRoute({
  method: "post",
  path: "/transcriptions",
  responses: {
    200: {
      content: { "application/json": { schema: VoiceTranscriptionResponse } },
      description: "Transcribed voice input",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid transcription request",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid voice upload token",
    },
    413: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Audio file too large",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Transcription is not configured",
    },
    502: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Transcription provider failed",
    },
  },
});
```

Route implementation outline:

```ts
export function createVoiceRoutes(deps: VoiceRouteDeps): OpenAPIHono<VoiceRouteEnv> {
  const voiceRoutes = new OpenAPIHono<VoiceRouteEnv>();

  voiceRoutes.openapi(createVoiceTranscriptionTokenRoute, deps.authMiddleware, async (c) => {
    const user = c.get("user");
    const token = await mintVoiceTranscriptionToken(
      c.env.VOICE_TOKEN_SIGNING_KEY,
      { userId: user.id },
    );
    return c.json(token, 200);
  });

  voiceRoutes.openapi(transcribeVoiceRoute, async (c) => {
    const token = readBearerToken(c.req.raw.headers.get("Authorization"));
    const payload = token
      ? await verifyVoiceTranscriptionToken(c.env.VOICE_TOKEN_SIGNING_KEY, token)
      : null;
    if (!payload) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const contentLength = c.req.raw.headers.get("Content-Length");
    if (contentLength && Number(contentLength) > payload.maxBytes) {
      return c.json({ error: "Audio file too large" }, 413);
    }

    const formData = await c.req.raw.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof File)) {
      return c.json({ error: "Audio file is required" }, 400);
    }
    if (audio.size <= 0) {
      return c.json({ error: "Audio file is empty" }, 400);
    }
    if (audio.size > payload.maxBytes) {
      return c.json({ error: "Audio file too large" }, 413);
    }
    if (!SUPPORTED_AUDIO_TYPES.has(audio.type)) {
      return c.json({ error: "Unsupported audio type" }, 400);
    }

    const service = deps.createVoiceTranscriptionService(c.env);
    const result = await service.transcribe({ audio, userId: payload.userId });
    if (!result.ok) {
      return c.json({ error: result.error.message }, result.error.status);
    }
    return c.json({ text: result.value.text }, 200);
  });

  return voiceRoutes;
}
```

Supported MIME types for v1:

```ts
const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mpga",
  "audio/m4a",
  "audio/wav",
]);
```

### Upload directly to the Worker with the voice token

Client token request still uses the same-origin Next proxy:

```ts
export async function createVoiceTranscriptionToken():
  Promise<VoiceTranscriptionTokenResponse> {
  return apiFetch("/voice/transcriptions/token", {
    method: "POST",
    cache: "no-store",
  });
}
```

Audio upload bypasses the proxy:

```ts
export async function uploadVoiceForTranscription(
  file: File,
): Promise<VoiceTranscriptionResponse> {
  const { token, maxBytes } = await createVoiceTranscriptionToken();
  if (file.size > maxBytes) {
    throw new Error("Recording is too large to transcribe.");
  }

  const formData = new FormData();
  formData.append("audio", file, file.name);

  const response = await fetch(`${WS_API_URL}/voice/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
  return VoiceTranscriptionResponse.parse(await response.json());
}
```

The API server should explicitly allow direct upload headers in CORS:

```ts
cors({
  origin: (origin) => origin,
  credentials: true,
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});
```

The upload route uses `Authorization` rather than a query token because `fetch` supports headers and this keeps tokens out of URLs, logs, and browser history.

### Record bounded audio in the browser

Recording constants:

```ts
const MAX_RECORDING_MS = 5 * 60 * 1000;
const TARGET_AUDIO_BITS_PER_SECOND = 96_000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
```

Five minutes at target bitrate is roughly:

```text
48 kbps  ~= 1.8 MB
64 kbps  ~= 2.4 MB
96 kbps  ~= 3.6 MB
128 kbps ~= 4.8 MB
```

`audioBitsPerSecond` is only a browser hint, so the implementation must check the resulting `File.size`.

Recording hook outline:

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    channelCount: 1,
  },
});

const recorder = new MediaRecorder(stream, {
  mimeType: selectSupportedVoiceMimeType(),
  audioBitsPerSecond: TARGET_AUDIO_BITS_PER_SECOND,
});

const chunks: Blob[] = [];
recorder.addEventListener("dataavailable", (event) => {
  if (event.data.size > 0) {
    chunks.push(event.data);
  }
});

recorder.start(1000);
const maxTimer = window.setTimeout(
  () => stopRecording({ action: "insert", reason: "max-duration" }),
  MAX_RECORDING_MS,
);
```

Stop/finalize behavior:

```ts
async function stopRecording(input: {
  action: "insert" | "send";
  reason: "manual" | "send" | "max-duration";
}) {
  window.clearTimeout(maxTimer);
  recorder.requestData();
  recorder.stop();

  const blob = await waitForRecorderStop(recorder, chunks);
  const file = new File([blob], "voice-message.webm", {
    type: blob.type || "audio/webm",
  });

  await saveVoiceDraft({
    id: crypto.randomUUID(),
    blob,
    fileName: file.name,
    mimeType: file.type,
    durationMs,
    createdAt: new Date().toISOString(),
  });

  const { text } = await uploadVoiceForTranscription(file);
  if (input.action === "send") {
    onSend({ content: text.trim() });
  } else {
    setInput((current) => current ? `${current}\n${text}` : text);
  }
  await deleteVoiceDraft();
}
```

Max-duration auto-stop uses `{ action: "insert", reason: "max-duration" }`. It transcribes and inserts into the composer, but it does not submit to the agent without a click.

### Preserve audio drafts until success

Store the latest pending voice draft in IndexedDB before upload:

```ts
type VoiceDraft = {
  id: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  durationMs: number;
  createdAt: string;
};
```

Draft lifecycle:

1. Save the draft before the transcription upload starts.
2. Keep the draft while status is `transcribing` or `error`.
3. On upload/transcription failure, show retry and discard controls.
4. Retry uses the same saved Blob/File.
5. Delete the draft only after transcript insertion/submission succeeds or the user discards it.

This is intentionally local-only. R2 is unnecessary because successful audio is not a durable product artifact.

### Composer UI state machine

States:

```ts
type VoiceInputState =
  | { status: "idle" }
  | { status: "requesting-permission" }
  | { status: "recording"; startedAt: number; elapsedMs: number; levels: number[] }
  | { status: "finalizing"; reason: "manual" | "send" | "max-duration" }
  | { status: "transcribing"; draftId: string }
  | { status: "error"; draftId: string; message: string };
```

Idle footer:

- left controls: image attach, agent mode;
- right controls: provider selector, microphone button, send button.

Recording footer:

- replace the footer controls with a full-width recording bar;
- show elapsed time, a waveform, and either:
  - a stop button that finalizes recording and inserts transcript into the composer;
  - or a send button that finalizes recording, transcribes, and submits the transcript as a chat message.
- keep the existing textarea visible so the user understands where the transcript will land.

Waveform rendering:

- Use `AudioContext` + `AnalyserNode` from the live microphone stream.
- Render 24-32 bars as regular DOM elements, not canvas, so the UI is themeable and testable.
- Animate bar height with CSS transitions and `requestAnimationFrame`.
- Under `prefers-reduced-motion: reduce`, keep the waveform static or update at a much lower cadence.
- No new animation dependency.

### Integrate both composer surfaces

The active session composer sends through `onSend` in `ChatInput`.

The session creation composer should use the same voice hook and waveform control, but final submit calls the existing session creation submit path. Since session creation has no active agent response to stop, its recording stop control only means "stop recording", not "stop agent".

Shared UI pieces:

```text
apps/web/hooks/use-voice-input.ts
apps/web/lib/voice-drafts.ts
apps/web/lib/voice-api.ts
apps/web/components/chat/mic-button.tsx
apps/web/components/chat/voice-recording-bar.tsx
```

Keep the hook UI-agnostic. It exposes recording state and finalize methods; each composer decides whether finalized text is inserted or submitted.

## Risks / Trade-offs

- [Risk] Browser `MediaRecorder` support and MIME behavior differs by browser. -> Mitigation: feature-detect `MediaRecorder`, choose the first supported MIME type, and hide/disable the mic button with a tooltip when unsupported.
- [Risk] A recording slightly exceeds expected size even with bitrate hints. -> Mitigation: enforce actual `File.size` client-side and server-side, and show a recoverable error with the saved draft.
- [Risk] The Worker still buffers multipart data during `formData()` parsing. -> Mitigation: keep the cap at 10 MB, reject by `Content-Length` when available, and use direct upload to remove the extra Next/Vercel buffering hop.
- [Risk] Stateless voice tokens can be replayed briefly. -> Mitigation: use a 45-second TTL, small byte cap, app-origin CORS, Authorization header, and existing authenticated token minting. Add one-time `jti` consumption later only if abuse appears.
- [Risk] STT mistakes send dangerous instructions to an agent. -> Mitigation: stop inserts transcript for review; only the explicit recording send action auto-submits.
- [Risk] Users navigate away during upload. -> Mitigation: save local draft before upload and expose retry on return when feasible.
- [Risk] Direct Worker uploads need CORS coverage. -> Mitigation: explicitly allow `Authorization` and `Content-Type` in API CORS config and add route tests for preflight if the test harness supports it.

## Migration Plan

1. Add shared schemas and API env types.
2. Add server voice token and transcription route plumbing behind no UI usage.
3. Add web client upload and recording hooks with tests.
4. Add composer UI in active chat, then session creation.
5. Run validation and manual browser QA.

Rollback:

- Hide the mic button or gate the voice hook behind a feature flag; the new API routes can remain unused.
- Existing text and image composer behavior is unchanged.

## Open Questions

- Whether production should default to `gpt-4o-mini-transcribe` or `gpt-4o-transcribe` after real-world testing on code-heavy dictation.
- Whether the explicit recording send action should submit immediately in session creation, or always insert transcript for review on that first-message surface.
