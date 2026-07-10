## ADDED Requirements

### Requirement: Cached transcript projection uses an authoritative provider

iOS SHALL resolve the transcript provider from the cached session summary or authoritative session live state before projecting cached assistant tool parts. iOS MUST NOT infer a provider from tool names, tool payloads, or message contents.

#### Scenario: Cached summary contains provider

- **WHEN** iOS opens a session whose cached summary and cached messages include a known provider
- **THEN** it builds the cached assistant transcript once with that provider before connecting the session WebSocket

#### Scenario: Legacy cached summary omits provider

- **WHEN** iOS loads cached assistant messages for a session whose cached summary has no provider
- **THEN** it stages the cached transcript behind the loading state and does not build generic or inferred tool groups

#### Scenario: Live state resolves legacy provider

- **WHEN** authoritative session live state supplies the provider for staged cached messages
- **THEN** iOS builds the cached transcript once with that provider and displays provider-specific tool groups

#### Scenario: Live state matches cached provider

- **WHEN** the session live-state provider matches the provider used for cached transcript projection
- **THEN** iOS does not rebuild the transcript solely because live state arrived

#### Scenario: Live state corrects cached provider

- **WHEN** the session live-state provider differs from the cached summary provider
- **THEN** iOS treats live state as authoritative and rebuilds existing assistant display data with the live provider

#### Scenario: Normalizer receives an unknown provider directly

- **WHEN** a caller explicitly invokes tool normalization with a missing or unsupported provider
- **THEN** iOS uses the documented generic `other` fallback without attempting provider inference
