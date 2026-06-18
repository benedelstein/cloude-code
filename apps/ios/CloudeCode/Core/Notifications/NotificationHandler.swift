import CoreAPI
import Foundation
import Observation
import UserNotifications

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

@MainActor
protocol NotificationHandling {
    /// Stores a decoded notification tap so the active view can route it.
    func handleNotificationTap(_ payload: NotificationPayload)

    /// Returns the system presentation options for a foreground notification.
    func presentationOptions(forForeground payload: NotificationPayload) -> UNNotificationPresentationOptions
}

@MainActor
protocol NotificationHandlerDelegate: AnyObject {
    /// Lets the active view decide whether a foreground route should be presented.
    func notificationHandler(
        _ handler: NotificationHandler,
        presentationOptionsFor route: NotificationRoute
    ) -> UNNotificationPresentationOptions
}

@MainActor
@Observable
final class NotificationHandler: NotificationHandling {
    nonisolated static let defaultPresentationOptions: UNNotificationPresentationOptions = [
        .banner,
        .list,
        .sound,
        .badge
    ]

    private(set) var notificationTap: NotificationRoute?
    @ObservationIgnored weak var delegate: (any NotificationHandlerDelegate)?

    /// Converts a decoded payload into a pending tap route for view-level handling.
    func handleNotificationTap(_ payload: NotificationPayload) {
        notificationTap = NotificationRoute(payload)
    }

    /// Asks the active delegate for foreground presentation, or returns defaults.
    func presentationOptions(forForeground payload: NotificationPayload) -> UNNotificationPresentationOptions {
        guard let route = NotificationRoute(payload) else {
            return Self.defaultPresentationOptions
        }

        return delegate?.notificationHandler(self, presentationOptionsFor: route)
            ?? Self.defaultPresentationOptions
    }

    /// Clears a pending tap only if it still matches the route that was handled.
    func consumeTap(_ route: NotificationRoute) {
        guard notificationTap == route else { return }
        notificationTap = nil
    }
}
