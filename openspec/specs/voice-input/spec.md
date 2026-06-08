# voice-input Specification

## Purpose
Voice input lets users dictate composer messages by recording microphone audio in the browser, transcribing it through the API server, and inserting or submitting the resulting transcript without exposing provider credentials to the client.

## Requirements
### Requirement: Voice transcription token authentication

The system SHALL provide an authenticated endpoint that mints a short-lived voice transcription upload token for the current user. The direct transcription upload route MUST verify that token before parsing or forwarding audio.

#### Scenario: Authenticated user mints a voice token

- **WHEN** an authenticated user requests a voice transcription token
- **THEN** the system returns a token, expiration timestamp, and maximum accepted audio bytes scoped to that user's id

#### Scenario: Unauthenticated token request is rejected

- **WHEN** a request without a valid app session requests a voice transcription token
- **THEN** the system rejects the request without minting a token

#### Scenario: Upload route rejects invalid token

- **WHEN** a client uploads audio with a missing, invalid, expired, or wrong-type voice token
- **THEN** the system rejects the upload without calling the transcription provider

#### Scenario: Token is minted after recording

- **WHEN** the browser has finished recording and has an audio file ready to upload
- **THEN** the browser requests a fresh voice transcription token before starting the direct upload

### Requirement: Direct bounded audio transcription upload

The system SHALL upload completed voice recordings directly from the browser to the API server Worker using multipart form data and SHALL return transcript text from a server-side transcription provider call.

#### Scenario: Valid upload returns transcript

- **WHEN** a client uploads a supported audio file within the configured byte limit using a valid voice token
- **THEN** the API server sends the audio file to the configured transcription provider and returns transcript text

#### Scenario: Oversized upload is rejected

- **WHEN** the uploaded audio file exceeds the configured maximum bytes
- **THEN** the API server returns a payload-too-large error and does not call the transcription provider

#### Scenario: Unsupported audio type is rejected

- **WHEN** the uploaded file has an unsupported audio MIME type
- **THEN** the API server returns an invalid-request error and does not call the transcription provider

#### Scenario: Transcription provider is unavailable

- **WHEN** the transcription provider request fails or returns a non-success response
- **THEN** the API server returns a provider-failure error without exposing provider credentials or raw provider error payloads to the client

### Requirement: Voice recording lifecycle

The web client SHALL record microphone audio with a five-minute maximum duration, finalize audio without losing it, and insert or submit the resulting transcript based on the user's explicit action.

#### Scenario: Manual stop inserts transcript

- **WHEN** the user records voice and activates the recording stop control
- **THEN** the client stops recording, transcribes the audio, and inserts the transcript into the composer

#### Scenario: Recording send submits transcript

- **WHEN** the user records voice and activates the recording send control
- **THEN** the client stops recording, transcribes the audio, and submits the transcript through the composer send path

#### Scenario: Maximum duration auto-finalizes safely

- **WHEN** a recording reaches the five-minute maximum duration
- **THEN** the client automatically stops recording, preserves the audio draft, starts transcription, and inserts the transcript into the composer when transcription succeeds

#### Scenario: Failed transcription preserves retryable audio

- **WHEN** upload or transcription fails after recording stops
- **THEN** the client keeps the recorded audio draft available for retry or discard instead of dropping it

### Requirement: Composer waveform recording UI

The web client SHALL expose voice recording through the existing composer footer and SHALL replace the footer controls with an animated waveform view while recording.

#### Scenario: Idle composer shows microphone button

- **WHEN** the composer is idle and microphone recording is supported
- **THEN** a microphone button appears next to the send button

#### Scenario: Recording view hides unrelated controls

- **WHEN** voice recording is active
- **THEN** the composer footer hides attachment, agent-mode, and provider controls and shows the recording waveform with the relevant stop or send action

#### Scenario: Waveform reflects microphone input

- **WHEN** microphone input levels change while recording
- **THEN** the waveform updates smoothly to reflect the current input levels

#### Scenario: Reduced motion is respected

- **WHEN** the user has reduced motion enabled
- **THEN** waveform animation is reduced or disabled while preserving recording controls and status

### Requirement: Server-side STT credential boundary

The system SHALL use server-side application credentials for transcription provider calls and MUST NOT expose provider credentials or use user OAuth tokens for STT.

#### Scenario: Browser uploads without provider key

- **WHEN** the browser uploads recorded audio for transcription
- **THEN** the request contains only the voice upload token and audio file, not an OpenAI or Anthropic credential

#### Scenario: API server calls provider

- **WHEN** the API server accepts a valid voice upload
- **THEN** it calls the configured transcription provider using server-side environment secrets
