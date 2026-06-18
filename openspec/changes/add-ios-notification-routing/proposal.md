## Why

iOS currently decodes notification payloads but does not route notification taps or suppress redundant foreground notifications. Users need push taps to return them to the relevant agent session, and the app should avoid showing a foreground push for the session already visible on screen.

## What Changes

- Add iOS notification routing for generated notification payloads, starting with `TURN_FINISHED`.
- Route notification taps from the notification delegate into Home navigation, replacing any currently visible session with the tapped session.
- Decide foreground notification presentation from current app navigation state, so notifications for the visible session are suppressed while notifications for other sessions still show.
- Keep `AgentSessionView` navigation based on `SessionSummaryModel`; do not introduce `SessionInfoResponse` navigation in this change.

## Capabilities

### New Capabilities

### Modified Capabilities
- `push-notifications`: Add iOS tap routing and foreground presentation behavior for decoded notification payloads.

## Impact

- Affects the iOS app target notification service, app DI wiring, Home navigation, and tests.
- Does not change the notification API contract, FCM payload format, backend notification publication, or agent session screen input model.
