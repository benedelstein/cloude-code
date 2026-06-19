## 1. Notification Handler

- [x] 1.1 Add `NotificationRoute` mapping from `CoreAPI.NotificationPayload` to session routes for `TURN_FINISHED`.
- [x] 1.2 Add a `NotificationHandling` protocol with tap and foreground presentation methods.
- [x] 1.3 Implement `NotificationHandler` as a shared main-actor observable object with pending tap route state.
- [x] 1.4 Add `NotificationHandlerDelegate` for foreground presentation decisions, with default presentation when no delegate is active.

## 2. Delegate And DI Wiring

- [x] 2.1 Update `NotificationRegistrationService` to accept `any NotificationHandling` instead of callback closures.
- [x] 2.2 In `willPresent`, call Firebase analytics, decode the payload, and await handler presentation options.
- [x] 2.3 In `didReceive`, call Firebase analytics, decode the payload, and hand taps to the handler.
- [x] 2.4 Wire `NotificationHandler` through `ApplicationComponent` and expose it to `HomeComponent`.

## 3. Home Routing

- [x] 3.1 Add `HomeRouter` in the Home layer with an explicit path of `[SessionSummaryModel]`.
- [x] 3.2 Wire `HomeRouter` from `HomeComponent` with `NotificationHandler` and `SessionSummaryStore`.
- [x] 3.3 Install `HomeRouter` as `NotificationHandlerDelegate` while Home is active.
- [x] 3.4 Consume `notificationTap` through `HomeRouter`, replacing the path with the target session when found.
- [x] 3.5 Record a missing notification target without navigating when no matching `SessionSummaryModel` exists.

## 4. Tests And Validation

- [x] 4.1 Add unit coverage for `NotificationRoute` payload mapping.
- [x] 4.2 Add unit coverage for foreground delegate presentation and no-delegate default fallback.
- [x] 4.3 Add unit coverage for Home route decisions: same session, different cached session, and missing session.
- [x] 4.4 Run `swiftlint lint --strict --no-cache`.
- [x] 4.5 Run the Debug simulator build with code signing disabled.
