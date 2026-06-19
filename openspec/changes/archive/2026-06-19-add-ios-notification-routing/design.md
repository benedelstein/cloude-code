## Context

The iOS app already registers FCM tokens and can decode `userInfo["payload"]` into the generated `NotificationPayload` type. The notification delegate currently drops decoded tap payloads and always presents foreground notifications.

Home owns the `NavigationStack` that pushes `AgentSessionView` with `SessionSummaryModel`. Current session visibility is therefore Home state and must be derived from the navigation path, not duplicated in app-level notification state.

## Goals / Non-Goals

**Goals:**
- Route `TURN_FINISHED` notification taps to the matching session when the active view can resolve the target `SessionSummaryModel`.
- If a different session is visible, replace the stack with the tapped session.
- Suppress foreground system notification presentation when the foreground notification belongs to the currently visible session.
- Use an explicit notification handling protocol instead of injecting callback closures into `NotificationRegistrationService`.

**Non-Goals:**
- Do not change `AgentSessionView`, `AgentSessionComponent`, or `AgentSessionViewModel` to accept `SessionInfoResponse`.
- Do not refresh the session list or fabricate a `SessionSummaryModel` for missing notification targets.
- Do not add message scrolling/highlighting for `messageId`.
- Do not change backend notification payload schemas or FCM publication.

## Decisions

### Use a notification handling protocol

`NotificationRegistrationService` will depend on a protocol rather than raw callbacks:

```swift
@MainActor
protocol NotificationHandling: AnyObject {
    func handleNotificationTap(_ payload: NotificationPayload)
    func presentationOptions(forForeground payload: NotificationPayload) -> UNNotificationPresentationOptions
}
```

The app implementation can be named `NotificationHandler` and shared through `ApplicationComponent`.

```swift
enum NotificationRoute: Equatable {
    case session(id: String, messageId: String)

    init?(_ payload: NotificationPayload) {
        switch payload {
        case .turnFinished(let payload):
            self = .session(id: payload.sessionId, messageId: payload.messageId)
        case .unknown:
            return nil
        }
    }
}
```

This keeps delegate parsing and app routing separated without creating a closure bag in DI.

### Foreground presentation uses an active delegate

Foreground presentation is request/response because iOS requires presentation options from `willPresent`. The app-level
handler will use a weak delegate for this synchronous decision. Home installs its router as the delegate while Home is
active because Home owns the session navigation path. If no delegate is active, the handler returns default options.

```swift
@MainActor
protocol NotificationHandlerDelegate: AnyObject {
    func notificationHandler(
        _ handler: NotificationHandler,
        presentationOptionsFor route: NotificationRoute
    ) -> UNNotificationPresentationOptions
}
```

```swift
@MainActor
@Observable
final class NotificationHandler: NotificationHandling {
    static let defaultPresentationOptions: UNNotificationPresentationOptions = [
        .banner,
        .list,
        .sound,
        .badge
    ]

    private(set) var notificationTap: NotificationRoute?
    weak var delegate: (any NotificationHandlerDelegate)?

    func handleNotificationTap(_ payload: NotificationPayload) {
        notificationTap = NotificationRoute(payload)
    }

    func presentationOptions(forForeground payload: NotificationPayload) -> UNNotificationPresentationOptions {
        guard let route = NotificationRoute(payload) else {
            return Self.defaultPresentationOptions
        }

        return delegate?.notificationHandler(self, presentationOptionsFor: route)
            ?? Self.defaultPresentationOptions
    }

    func consumeTap(_ route: NotificationRoute) {
        guard notificationTap == route else { return }
        notificationTap = nil
    }
}
```

HomeRouter is Home-layer state. It owns the navigation path, installs itself as the delegate while active, and answers
foreground presentation from `path`:

```swift
@MainActor
@Observable
final class HomeRouter: NotificationHandlerDelegate {
    var path: [SessionSummaryModel] = []

    private let notificationHandler: NotificationHandler
    private let sessionSummaryStore: SessionSummaryStore

    init(
        notificationHandler: NotificationHandler,
        sessionSummaryStore: SessionSummaryStore
    ) {
        self.notificationHandler = notificationHandler
        self.sessionSummaryStore = sessionSummaryStore
    }

    func start() {
        notificationHandler.delegate = self
    }

    func stop() {
        if notificationHandler.delegate === self {
            notificationHandler.delegate = nil
        }
    }

    func notificationHandler(
        _ handler: NotificationHandler,
        presentationOptionsFor route: NotificationRoute
    ) -> UNNotificationPresentationOptions {
        switch route {
        case .session(let sessionId, _):
            return path.last?.id == sessionId
                ? []
                : NotificationHandler.defaultPresentationOptions
        }
    }
}
```

`HomeComponent`, not `ApplicationComponent`, constructs `HomeRouter`:

```swift
@MainActor
var router: HomeRouter {
    shared {
        HomeRouter(
            notificationHandler: dependency.notificationHandler,
            sessionSummaryStore: dependency.sessionSummaryStore
        )
    }
}
```

`HomeView` binds navigation to the router and starts/stops the delegate lifecycle:

```swift
NavigationStack(path: $router.path) {
    content
        .navigationDestination(for: SessionSummaryModel.self) { session in
            sessionBuilder.build(session: session)
        }
}
.task {
    router.start()
}
.onDisappear {
    router.stop()
}
```

The delegate method is already async, so it can await the request result:

```swift
nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
) async -> UNNotificationPresentationOptions {
    let userInfo = notification.request.content.userInfo
    Messaging.messaging().appDidReceiveMessage(userInfo)

    guard let payload = NotificationPayload(from: userInfo) else {
        return NotificationHandler.defaultPresentationOptions
    }

    return await notificationHandler.presentationOptions(forForeground: payload)
}
```

The `await` is only the main-actor hop into `NotificationHandler`; there is no stored foreground continuation. If the app
is loading, signed out, or otherwise has no active Home delegate, the fallback is immediate default foreground
presentation.

### Taps are deferred to the active view

The handler stores the decoded tap route until an active view consumes it:

```swift
nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse
) async {
    let userInfo = response.notification.request.content.userInfo
    Messaging.messaging().appDidReceiveMessage(userInfo)

    guard let payload = NotificationPayload(from: userInfo) else {
        return
    }

    await notificationHandler.handleNotificationTap(payload)
}
```

HomeRouter consumes session tap routes from the session summary store. The store
lookup uses the normal memory/disk cascade so a notification can open a cached
session even if Home has not populated the in-memory map yet.

```swift
.onChange(of: notificationHandler.notificationTap) { _, route in
    guard let route else { return }
    Task {
        await router.handleNotificationTap(route)
    }
}
```

```swift
func handleNotificationTap(_ route: NotificationRoute) async {
    switch route {
    case .session(let sessionId, _):
        guard path.last?.id != sessionId else {
            notificationHandler.consumeTap(route)
            return
        }

        guard let target = try? await sessionSummaryStore.get([sessionId]).first else {
            recordMissingNotificationSession(id: sessionId)
            notificationHandler.consumeTap(route)
            return
        }

        path = [target]
        notificationHandler.consumeTap(route)
    }
}
```

`path = [target]` is the intended pop-and-push behavior. If session A is visible and session B is tapped, the stack becomes only session B.

### Keep missing-session behavior conservative

Because the session screen still requires `SessionSummaryModel`, the app will not fetch `GET /sessions/:id` and navigate from `SessionInfoResponse` in this change. If the target summary is not in memory or disk, Home will log the missing target and consume the route.

## Risks / Trade-offs

- Missing session summaries cannot be opened from a notification yet → Keep the behavior explicit and avoid fabricating incomplete models; a later change can introduce a summary fetch endpoint or broader session navigation input.
- Foreground presentation falls back when no delegate is active → This intentionally shows notifications while the app is loading, signed out, or not displaying Home.
- Tap route can arrive before Home appears → Store the pending tap route in the shared handler until an active view consumes it.
