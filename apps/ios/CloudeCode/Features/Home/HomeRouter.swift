import Domain
import Entities
import Foundation
import Observation
import UserNotifications

enum HomeDestination: Hashable {
    case session(SessionSummaryModel)
    case newSession(id: UUID)
}

@MainActor
@Observable
final class HomeRouter: NotificationHandlerDelegate {
    var path: [HomeDestination] = []

    @ObservationIgnored private let notificationHandler: NotificationHandler
    @ObservationIgnored private let sessionSummaryStore: SessionSummaryStore
    @ObservationIgnored private var navigationRequestID = 0

    var notificationTap: NotificationRoute? {
        notificationHandler.notificationTap
    }

    init(
        notificationHandler: NotificationHandler,
        sessionSummaryStore: SessionSummaryStore
    ) {
        self.notificationHandler = notificationHandler
        self.sessionSummaryStore = sessionSummaryStore
    }

    /// Installs this router as the foreground notification presenter while Home is active.
    func start() {
        notificationHandler.delegate = self
    }

    /// Clears the foreground notification delegate if this router is still installed.
    func stop() {
        if notificationHandler.delegate === self {
            notificationHandler.delegate = nil
        }
    }

    /// Suppresses foreground notifications for the currently visible session.
    func notificationHandler(
        _ handler: NotificationHandler,
        presentationOptionsFor route: NotificationRoute
    ) -> UNNotificationPresentationOptions {
        switch route {
        case .session(let sessionId, _):
            path.last?.sessionId == sessionId
                ? []
                : NotificationHandler.defaultPresentationOptions
        }
    }

    /// Routes a notification tap by replacing Home's navigation path with the target session.
    func handleNotificationTap(_ route: NotificationRoute) async {
        navigationRequestID += 1
        let requestID = navigationRequestID

        switch route {
        case .session(let sessionId, _):
            guard path.last?.sessionId != sessionId else {
                notificationHandler.consumeTap(route)
                return
            }

            guard let target = await sessionSummary(for: sessionId) else {
                Logger.warning("Notification target session missing:", sessionId)
                notificationHandler.consumeTap(route)
                return
            }

            if !path.isEmpty {
                path.removeAll()
                // Future optimization: replace this fixed pause with a scroll view delegate
                // completion signal once navigation pop exposes a reliable finish callback.
                try? await Task.sleep(nanoseconds: 400_000_000)

                guard requestID == navigationRequestID, !Task.isCancelled else {
                    return
                }
            }

            path = [.session(target)]
            notificationHandler.consumeTap(route)
        }
    }

    /// Pushes an independent draft session destination.
    func pushNewSession() {
        path.append(.newSession(id: UUID()))
    }

    /// Routes the currently pending notification tap, if one exists.
    func handlePendingNotificationTap() async {
        guard let route = notificationHandler.notificationTap else {
            return
        }

        await handleNotificationTap(route)
    }

    private func sessionSummary(for sessionId: String) async -> SessionSummaryModel? {
        do {
            return try await sessionSummaryStore.get([sessionId]).first
        } catch {
            Logger.warning("Notification target session lookup failed:", sessionId, error)
            return nil
        }
    }
}

private extension HomeDestination {
    @MainActor
    var sessionId: String? {
        guard case .session(let session) = self else {
            return nil
        }
        return session.id
    }
}
