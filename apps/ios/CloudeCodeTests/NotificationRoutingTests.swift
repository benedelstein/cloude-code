@testable import CloudeCode
import CoreAPI
import Domain
import Entities
import Foundation
import Testing

@MainActor
@Suite("Notification routing")
struct NotificationRoutingTests {
    @Test func mapsTurnFinishedPayloadToSessionRoute() {
        let payload = NotificationPayload.turnFinished(.init(
            sessionId: "session-1",
            messageId: "message-1",
            repoFullName: "owner/repo"
        ))

        #expect(NotificationRoute(payload) == .session(id: "session-1", messageId: "message-1"))
    }

    @Test func ignoresUnknownPayloadRoute() {
        #expect(NotificationRoute(.unknown(type: "NEW_TYPE")) == nil)
    }

    @Test func defaultsForegroundPresentationWithoutDelegate() {
        let handler = NotificationHandler()
        let payload = turnFinishedPayload(sessionId: "session-1")

        let options = handler.presentationOptions(forForeground: payload)

        #expect(options == NotificationHandler.defaultPresentationOptions)
    }

    @Test func suppressesForegroundPresentationForVisibleSession() {
        let handler = NotificationHandler()
        let store = SessionSummaryStore()
        let visible = store.putMemory([sessionSummary(id: "session-1")])[0]
        let router = HomeRouter(notificationHandler: handler, sessionSummaryStore: store)
        router.path = [.session(visible)]
        router.start()

        let options = handler.presentationOptions(forForeground: turnFinishedPayload(sessionId: "session-1"))

        #expect(options.isEmpty)
        router.stop()
    }

    @Test func presentsForegroundNotificationForDifferentSession() {
        let handler = NotificationHandler()
        let store = SessionSummaryStore()
        let visible = store.putMemory([sessionSummary(id: "session-1")])[0]
        let router = HomeRouter(notificationHandler: handler, sessionSummaryStore: store)
        router.path = [.session(visible)]
        router.start()

        let options = handler.presentationOptions(forForeground: turnFinishedPayload(sessionId: "session-2"))

        #expect(options == NotificationHandler.defaultPresentationOptions)
        router.stop()
    }

    @Test func suppressesForegroundNotificationForCreatedDraftSession() {
        let handler = NotificationHandler()
        let store = SessionSummaryStore()
        let router = HomeRouter(notificationHandler: handler, sessionSummaryStore: store)
        let draftId = UUID()
        router.path = [.newSession(id: draftId)]
        router.adoptDraftSession(id: "session-1", for: draftId)
        router.start()

        let options = handler.presentationOptions(forForeground: turnFinishedPayload(sessionId: "session-1"))

        #expect(options.isEmpty)
        router.stop()
    }

    @Test func tapForVisibleSessionLeavesPathUnchangedAndConsumesRoute() async {
        let handler = NotificationHandler()
        let store = SessionSummaryStore()
        let visible = store.putMemory([sessionSummary(id: "session-1")])[0]
        let router = HomeRouter(notificationHandler: handler, sessionSummaryStore: store)
        router.path = [.session(visible)]

        handler.handleNotificationTap(turnFinishedPayload(sessionId: "session-1"))
        await router.handlePendingNotificationTap()

        #expect(router.path == [.session(visible)])
        #expect(handler.notificationTap == nil)
    }

    @Test func tapForCreatedDraftSessionLeavesPathUnchangedAndConsumesRoute() async {
        let handler = NotificationHandler()
        let store = SessionSummaryStore()
        let router = HomeRouter(notificationHandler: handler, sessionSummaryStore: store)
        let draftId = UUID()
        let draftDestination = HomeDestination.newSession(id: draftId)
        router.path = [draftDestination]
        router.adoptDraftSession(id: "session-1", for: draftId)

        handler.handleNotificationTap(turnFinishedPayload(sessionId: "session-1"))
        await router.handlePendingNotificationTap()

        #expect(router.path == [draftDestination])
        #expect(handler.notificationTap == nil)
    }

    @Test func tapForDifferentCachedSessionReplacesPath() async {
        let handler = NotificationHandler()
        let store = SessionSummaryStore()
        let sessions = store.putMemory([
            sessionSummary(id: "session-1"),
            sessionSummary(id: "session-2")
        ])
        let router = HomeRouter(notificationHandler: handler, sessionSummaryStore: store)
        router.path = [.session(sessions[0])]

        handler.handleNotificationTap(turnFinishedPayload(sessionId: "session-2"))
        await router.handlePendingNotificationTap()

        #expect(router.path == [.session(sessions[1])])
        #expect(handler.notificationTap == nil)
    }

    @Test func tapForDiskCachedSessionReplacesPath() async throws {
        let handler = NotificationHandler()
        let cache = try makeCache()
        let visible = sessionSummary(id: "session-1")
        let diskOnly = sessionSummary(id: "session-2")
        try await cache.put(SessionSummaryEntity.self, snapshots: [diskOnly])
        let store = SessionSummaryStore(cache: cache)
        let router = HomeRouter(notificationHandler: handler, sessionSummaryStore: store)
        let visibleModel = store.putMemory([visible])[0]
        router.path = [.session(visibleModel)]

        handler.handleNotificationTap(turnFinishedPayload(sessionId: "session-2"))
        await router.handlePendingNotificationTap()

        #expect(router.path.sessionIds == ["session-2"])
        #expect(handler.notificationTap == nil)
    }

    @Test func tapForMissingSessionDoesNotNavigateAndConsumesRoute() async {
        let handler = NotificationHandler()
        let store = SessionSummaryStore()
        let visible = store.putMemory([sessionSummary(id: "session-1")])[0]
        let router = HomeRouter(notificationHandler: handler, sessionSummaryStore: store)
        router.path = [.session(visible)]

        handler.handleNotificationTap(turnFinishedPayload(sessionId: "missing-session"))
        await router.handlePendingNotificationTap()

        #expect(router.path == [.session(visible)])
        #expect(handler.notificationTap == nil)
    }

    private func makeCache() throws -> Cache {
        try Cache(container: ModelContainerFactory().make(inMemory: true))
    }

    private func turnFinishedPayload(sessionId: String) -> NotificationPayload {
        .turnFinished(.init(
            sessionId: sessionId,
            messageId: "message-\(sessionId)",
            repoFullName: "owner/repo"
        ))
    }

    private func sessionSummary(id: String) -> Domain.SessionSummary {
        Domain.SessionSummary(
            id: id,
            repoId: 42,
            repoFullName: "owner/repo",
            title: "Session \(id)",
            archived: false,
            workingState: "ready",
            pushedBranch: nil,
            pullRequest: nil,
            createdAt: "2026-06-18T00:00:00.000Z",
            updatedAt: "2026-06-18T00:00:00.000Z",
            lastMessageAt: nil,
            lastAssistantMessageId: nil,
            hasUnread: false
        )
    }
}

private extension Array where Element == HomeDestination {
    @MainActor
    var sessionIds: [String] {
        compactMap { destination in
            guard case .session(let session) = destination else {
                return nil
            }
            return session.id
        }
    }
}
