## ADDED Requirements

### Requirement: iOS notification tap routing
The iOS app SHALL route decoded notification taps to the matching app destination when the destination can be resolved from current app state.

#### Scenario: Turn-finished tap opens cached session
- **WHEN** the user taps a notification with a valid `TURN_FINISHED` payload whose `sessionId` matches a session summary loaded in Home
- **THEN** the app navigates to that session's agent session view

#### Scenario: Turn-finished tap replaces visible session
- **WHEN** the user taps a notification for session B while Home's navigation path is displaying session A
- **THEN** the app replaces the navigation path with session B

#### Scenario: Turn-finished tap for visible session
- **WHEN** the user taps a notification for the same session currently visible in Home's navigation path
- **THEN** the app leaves the navigation path unchanged and consumes the pending notification route

#### Scenario: Turn-finished tap for missing summary
- **WHEN** the user taps a notification whose `sessionId` does not match any loaded `SessionSummaryModel`
- **THEN** the app does not navigate and records a missing notification target without fabricating a session summary

### Requirement: iOS foreground notification presentation
The iOS app SHALL decide foreground notification presentation from current navigation state before returning presentation options to iOS.

#### Scenario: Foreground notification for visible session
- **WHEN** iOS receives a foreground notification with a valid `TURN_FINISHED` payload for the session currently visible in Home's navigation path
- **THEN** the app returns empty notification presentation options

#### Scenario: Foreground notification for another session
- **WHEN** iOS receives a foreground notification with a valid `TURN_FINISHED` payload for a session other than the one currently visible in Home's navigation path
- **THEN** the app returns default foreground presentation options including banner, list, sound, and badge

#### Scenario: Foreground notification without active delegate
- **WHEN** iOS receives a foreground notification and no notification handler delegate is active
- **THEN** the app returns default foreground presentation options

### Requirement: iOS notification delegate handoff
The iOS notification delegate SHALL parse notification payloads and hand decoded payloads to an app notification handler protocol.

#### Scenario: Delegate receives tap payload
- **WHEN** the notification delegate receives a tap response containing a valid string `payload`
- **THEN** it decodes the payload and calls the notification handler tap method

#### Scenario: Delegate receives foreground payload
- **WHEN** the notification delegate receives a foreground notification containing a valid string `payload`
- **THEN** it decodes the payload and awaits notification handler presentation options before returning to iOS

#### Scenario: Delegate receives undecodable payload
- **WHEN** the notification delegate receives a notification without a decodable string `payload`
- **THEN** it does not create a notification route and uses default foreground presentation behavior where a presentation decision is required
