## ADDED Requirements

### Requirement: Session summary persists the selected provider

The system SHALL persist a session's selected provider in the existing D1 session summary row. The persisted value MUST be the provider used to initialize the session Durable Object, including the configured default when the create request omits a provider.

#### Scenario: New session selects a provider

- **WHEN** a session is created with an explicit supported provider
- **THEN** the D1 session row stores that provider and the Durable Object initializes with the same provider

#### Scenario: New session uses the default provider

- **WHEN** a session is created without an explicit provider
- **THEN** the server resolves the configured default once and stores that provider in both the D1 session row and Durable Object state

### Requirement: Legacy summaries do not fabricate provider

The D1 provider field and session summary provider SHALL allow an unknown value for rows created before provider persistence. The system MUST leave legacy provider values null and MUST NOT assign the current default or reconcile them from Durable Object state.

#### Scenario: Legacy session is listed

- **WHEN** a legacy D1 session row has no provider
- **THEN** the session summary returns provider as null or absent rather than substituting a default
