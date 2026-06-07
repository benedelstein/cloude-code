## 1. Shared Contracts And Configuration

- [x] 1.1 Add shared `VoiceTranscriptionTokenResponse` and `VoiceTranscriptionResponse` Zod schemas and exported types.
- [x] 1.2 Add API server env typings for `OPENAI_API_KEY`, optional `OPENAI_TRANSCRIPTION_MODEL`, and `VOICE_TOKEN_SIGNING_KEY`.
- [x] 1.3 Add wrangler secret/config documentation for the new voice transcription environment values.
- [x] 1.4 Update API CORS configuration to explicitly allow direct upload `Authorization` and `Content-Type` headers.

## 2. API Server Voice Module

- [x] 2.1 Create a voice transcription token service with distinct token type `voice-transcription`, 90-second TTL, `userId`, `exp`, `jti`, and `maxBytes` payload fields.
- [x] 2.2 Add token verification tests for valid, expired, wrong-signature, malformed, and wrong-type voice tokens.
- [x] 2.3 Add `POST /voice/transcriptions/token` OpenAPI schema and route authenticated through existing app session auth.
- [x] 2.4 Add `POST /voice/transcriptions` OpenAPI schema and route that verifies the voice bearer token before parsing multipart data.
- [x] 2.5 Validate uploaded `audio` file presence, nonzero size, maximum bytes, and supported audio MIME type.
- [x] 2.6 Add an OpenAI transcription service that builds the multipart provider request with server-side `OPENAI_API_KEY` and model env override.
- [x] 2.7 Map local validation, missing config, and provider failures to stable client errors without logging raw audio or transcript text.
- [x] 2.8 Wire `buildVoiceRoutes()` into API route composition and `services/api-server/src/index.ts`.

## 3. Web Voice Upload And Draft State

- [x] 3.1 Add client API function to mint a voice transcription token through `/api/voice/transcriptions/token`.
- [x] 3.2 Add direct Worker upload helper that posts `FormData` to `${NEXT_PUBLIC_API_URL}/voice/transcriptions` with `Authorization: Bearer <voice-token>`.
- [x] 3.3 Add IndexedDB voice draft helpers for save, load, delete, retry, and discard of the latest pending recording.
- [x] 3.4 Add `useVoiceInput` hook for permission request, `MediaRecorder` setup, chunk collection, max-duration auto-stop, finalization, upload, retry, and cleanup.
- [x] 3.5 Feature-detect `MediaRecorder` and supported MIME types and expose an unsupported state to the UI.
- [x] 3.6 Enforce actual recorded `File.size` before upload and surface retryable errors while keeping the draft.

## 4. Composer UI Integration

- [x] 4.1 Add a microphone icon button next to `SendButton` in the idle active-session composer.
- [x] 4.2 Add `VoiceRecordingBar` that replaces the composer footer controls while recording, finalizing, transcribing, or showing a retryable error.
- [x] 4.3 Render live waveform bars from Web Audio analyser levels with CSS transitions and reduced-motion handling.
- [x] 4.4 Wire recording stop to transcribe and insert transcript into the active-session composer input.
- [x] 4.5 Wire recording send to transcribe and submit transcript through the active-session `onSend` path.
- [x] 4.6 Keep existing text, attachment, provider auth, upload-disabled, and agent-stop behaviors unchanged outside voice recording state.
- [x] 4.7 Integrate the same voice controls into the session creation composer, using that surface's existing submit path.

## 5. Tests

- [x] 5.1 Add API route tests for token mint auth, invalid upload token rejection, missing file, oversized file, unsupported MIME type, and provider failure mapping.
- [x] 5.2 Add service tests for OpenAI transcription request construction, model override, and response parsing.
- [x] 5.3 Add web unit tests for `useVoiceInput` state transitions, max-duration auto-stop, retryable draft preservation, and size rejection.
- [x] 5.4 Add composer tests for idle mic button rendering, recording footer replacement, stop-to-insert, send-to-submit, and disabled/unsupported states.
- [x] 5.5 Add session creation composer tests for voice transcript insertion/submission behavior.

## 6. Validation

- [x] 6.1 Run `pnpm build`.
- [x] 6.2 Run `pnpm lint`.
- [x] 6.3 Run `pnpm typecheck`.
- [x] 6.4 Run relevant package tests, including API server and web tests.
- [ ] 6.5 Run the web app locally and verify the voice composer visually in desktop and mobile browser viewports.
- [ ] 6.6 Manually verify microphone permission denial, normal recording, stop-to-insert, send-to-submit, five-minute auto-stop behavior, failed upload retry, and successful transcript cleanup.
