## Why

Users need a fast way to dictate chat messages without leaving the composer. Voice input has to handle multi-minute audio reliably, so it should avoid the existing Next.js proxy path that buffers request bodies and can hit hosting payload limits before the API server receives the file.

## What Changes

- Add a voice input mode to the chat composer with a microphone button next to send.
- Replace the composer footer with an animated waveform while recording and hide attachment, agent-mode, and provider controls during active capture.
- Add server-side voice transcription APIs:
  - an authenticated route that mints a short-lived voice upload token;
  - a direct Worker upload route that accepts bounded multipart audio and returns transcript text.
- Use an app-owned OpenAI transcription key and default to `gpt-4o-mini-transcribe`, with an environment override for the transcription model.
- Record browser audio with `MediaRecorder`, cap recordings at five minutes, and preserve pending audio locally until transcription succeeds or the user discards it.
- Insert the transcript into the composer after stop, and submit it immediately only when the user explicitly uses the recording send action.

## Capabilities

### New Capabilities

- `voice-input`: Voice recording, waveform UI, direct audio upload, server-side transcription, and transcript insertion/submission from the chat composer.

### Modified Capabilities

- None.

## Impact

- API server: new voice module, OpenAPI route schemas, token mint/verify service, transcription service, CORS header coverage for direct browser upload, environment bindings for OpenAI and voice token signing.
- Shared package: new Zod schemas and exported response types for voice token and transcription responses.
- Web app: new recording/transcription hook, waveform UI component, client API function for minting voice tokens, direct upload helper using `NEXT_PUBLIC_API_URL`, and composer integrations in active chat and session creation.
- External dependency: OpenAI Audio Transcriptions API, called only from the API server.
- Browser APIs: `navigator.mediaDevices.getUserMedia`, `MediaRecorder`, IndexedDB, and Web Audio `AnalyserNode`.
- Tests: token verification, route rejection, upload validation, OpenAI request construction, recording state transitions, composer button behavior, and transcript insertion/submission.
