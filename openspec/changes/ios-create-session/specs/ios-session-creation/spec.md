# ios-session-creation Specification

## ADDED Requirements

### Requirement: New-session entry point
The Home sessions list SHALL show a glass floating action button (bottom-trailing, chat-plus icon) that pushes a draft session screen onto the existing navigation stack, using the same screen scaffold as an existing session.

#### Scenario: FAB pushes a draft session screen
- **WHEN** the user taps the FAB on Home
- **THEN** a session screen is pushed with an empty transcript, the composer, the repo/branch picker bar, and the model picker button, titled "New session"

#### Scenario: Repeated pushes are independent
- **WHEN** the user opens a draft screen, navigates back without sending, and taps the FAB again
- **THEN** a fresh draft screen appears with no residue from the abandoned draft (composer text is not carried over)

### Requirement: Draft-mode session screen
The session screen SHALL operate without a session id ("draft mode"). In draft mode it SHALL render the same single transcript scrollview used for existing sessions with zero rows (no alternate view tree), SHALL NOT connect a websocket, SHALL NOT read or write the on-disk message cache, and SHALL load the model catalog and repo list instead.

#### Scenario: Draft screen shows empty transcript, not a spinner
- **WHEN** the draft screen appears
- **THEN** the transcript area shows the empty state immediately (no message-loading spinner) while the model catalog and repo list load

#### Scenario: No persistence before an id exists
- **WHEN** the user types a message and adds attachments in draft mode
- **THEN** nothing is written to the session message disk cache

### Requirement: Send creates the session with the message riding along
When the user sends in draft mode, the app SHALL issue a single `POST /sessions` request whose `initialMessage` carries the composer content and any uploaded attachment ids, along with the selected `repoId`, the selected branch (omitted when it equals the repo default), and `settings` with the selected provider/model (omitted entirely when no model is selected, letting the server apply defaults).

#### Scenario: One combined request
- **WHEN** the user taps send in draft mode
- **THEN** exactly one create-session request is sent and no separate send-message call is made

#### Scenario: Default branch omitted
- **WHEN** the selected branch equals the repo's default branch
- **THEN** the request omits the `branch` field

### Requirement: Optimistic first message
On send in draft mode, the app SHALL insert the user's message into the transcript and show the working indicator immediately, before the create request completes. Sending SHALL be disabled until a repo is selected, and SHALL NOT require a websocket connection.

#### Scenario: Message appears before the round-trip
- **WHEN** the user taps send
- **THEN** the user message row and the working indicator are visible before the create response arrives

#### Scenario: Send gated on repo only
- **WHEN** no repo is selected
- **THEN** the send button is disabled; selecting a repo enables it even though no socket is connected

### Requirement: Session adoption after successful creation
When creation succeeds, the view model SHALL adopt the returned session id: persist a canonical session summary (so the Home list shows the session without duplicating the server's summary-created event), bind the attachment store to the id, create and connect the session websocket, and let the initial sync response reconcile the optimistic message and persist messages through the existing paths. The navigation title SHALL adopt the server-generated title. The Home router SHALL associate the created session id with the stable draft navigation destination so notification handling recognizes the visible live session without rebuilding its transcript view.

#### Scenario: Seamless transition to a live session
- **WHEN** creation succeeds
- **THEN** the same screen connects the socket, streams the agent response below the optimistic message, and the optimistic message is reconciled with the server echo without duplication

#### Scenario: Finished notification for a created session is suppressed while visible
- **WHEN** a draft has created its session and remains visible
- **AND** a turn-finished notification arrives for that created session
- **THEN** the app suppresses the foreground notification and leaves the active draft route in place

#### Scenario: Home list consistency
- **WHEN** the user navigates back after creating a session
- **THEN** the session appears exactly once in the Home list

#### Scenario: Pickers disappear after creation
- **WHEN** the session id binds
- **THEN** the repo/branch picker bar disappears and the composer shrinks accordingly

### Requirement: Creation failure resets the draft
If the create request fails, the app SHALL retract the optimistic message, restore the composer draft text and attachments, clear the working indicator, surface the error to the user, and remain in draft mode ready to retry. No session or message state SHALL have been persisted.

#### Scenario: Failed create retracts and restores
- **WHEN** the create request fails (e.g. network error, repo not accessible, rate limit)
- **THEN** the optimistic message disappears, the draft text and attachments are restored in the composer, an error toast is shown, and the user can retry

### Requirement: Pre-creation attachments
Image attachments added in draft mode SHALL upload without a session id and be bound to the session at creation time via `initialMessage.attachmentIds`.

#### Scenario: Attachment added before the session exists
- **WHEN** the user attaches an image in draft mode and sends
- **THEN** the image uploads with no session id, its id rides in the create request, and it renders in the created session's first message
