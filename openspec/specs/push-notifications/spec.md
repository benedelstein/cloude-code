## Purpose
Define how the iOS app registers push notification tokens and how the API server publishes turn-finished notifications through Firebase Cloud Messaging.
## Requirements
### Requirement: Authenticated FCM token registration
The system SHALL allow an authenticated iOS client to register or refresh an FCM token for a stable device id.

#### Scenario: Register new token
- **WHEN** an authenticated client posts a valid device id, FCM token, and platform to the notifications token endpoint
- **THEN** the system stores an active `fcm_tokens` row for the authenticated user and device id

#### Scenario: Replace rotated token
- **WHEN** an authenticated client posts a different FCM token for an existing user id and device id
- **THEN** the system replaces the stored token, updates last-seen timestamps, and clears any prior invalidation marker for that device row

#### Scenario: Reject unauthenticated token upload
- **WHEN** a request to register an FCM token has no valid user authentication
- **THEN** the system rejects the request without storing token data

### Requirement: Notification payload contract
The system SHALL define notification payload wire types in the API contract with a string discriminator suitable for iOS enum-based routing.

#### Scenario: Turn-finished payload contract
- **WHEN** the notification payload type is generated for clients
- **THEN** it includes a `TURN_FINISHED` payload variant with `version`, `sessionId`, `messageId`, and `repoFullName`

#### Scenario: Future payload compatibility
- **WHEN** future notification payload variants are added to the API contract
- **THEN** generated iOS types preserve decode-tolerant unknown handling unless the type is explicitly marked frozen

### Requirement: Queued turn-finished notification publication
The system SHALL enqueue a semantic notification event after a non-aborted agent turn finishes.

#### Scenario: Successful turn finish
- **WHEN** an agent turn completes without being marked aborted
- **THEN** the system enqueues a notification event for the session owner with a `TURN_FINISHED` payload

#### Scenario: Aborted turn finish
- **WHEN** an agent turn is aborted or canceled
- **THEN** the system does not enqueue a turn-finished push notification

#### Scenario: Enqueue failure
- **WHEN** notification enqueueing fails after turn state has been persisted
- **THEN** the system logs the failure and does not fail or roll back the completed turn

### Requirement: FCM HTTP v1 delivery
The system SHALL deliver queued notification events to active user FCM tokens using Firebase Cloud Messaging HTTP v1.

#### Scenario: Deliver to active tokens
- **WHEN** the notification queue consumer receives a `TURN_FINISHED` notification event for a user with active FCM tokens
- **THEN** it sends one FCM HTTP v1 message per active token

#### Scenario: String userInfo payload
- **WHEN** the queue consumer constructs an FCM message
- **THEN** the message data contains only string values, including `notification_type` and a JSON-stringified `payload`

#### Scenario: Invalidate terminal token failures
- **WHEN** FCM reports a terminal invalid or unregistered token error for a stored token
- **THEN** the system marks that token row invalid and excludes it from later notification sends

#### Scenario: Retry transient failures
- **WHEN** queue processing fails because of transient Firebase or network errors
- **THEN** the queue message remains eligible for Cloudflare Queue retry according to the configured retry policy

### Requirement: iOS Firebase Messaging integration
The iOS app SHALL register for Firebase Messaging tokens and upload them after user authentication is available.

#### Scenario: Token received before sign-in
- **WHEN** the app receives an FCM token before an authenticated API session is available
- **THEN** the app retains enough local token state to upload it after sign-in or session restoration

#### Scenario: Token refresh
- **WHEN** Firebase Messaging provides a new token for the app installation
- **THEN** the app uploads the new token with the stable device id to the authenticated API endpoint

#### Scenario: Notification payload decoding path
- **WHEN** iOS receives a push notification containing a string `payload` value
- **THEN** the app can decode that JSON string into the generated notification payload type for future routing

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

