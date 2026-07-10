## ADDED Requirements

### Requirement: Full session summaries expose provider metadata

The system SHALL include the session provider in D1-backed full `SessionSummary` payloads used by HTTP session lists and user-sessions stream events. The field MUST accept null or absence during rollout and for legacy rows.

#### Scenario: HTTP list returns a known provider

- **WHEN** a D1 session row contains a provider and the client lists sessions
- **THEN** the returned full session summary includes that provider

#### Scenario: Legacy summary has no provider

- **WHEN** a legacy D1 session row contains no provider
- **THEN** HTTP and user-sessions stream summary decoding succeeds with provider null or absent
