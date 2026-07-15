import API
@testable import CloudeCode
import Domain
import Entities
import Foundation
import Testing

@Suite("Reactive sign-out cache reset")
@MainActor
struct SessionStoreTests {
    @Test func explicitSignOutTriggersCacheResetWorker() async throws {
        let recorder = SignOutEventRecorder()
        let authAPI = TestAuthAPI(session: Self.session, recorder: recorder)
        let coordinator = TokenCoordinator(
            persistence: TestSessionPersistence(session: Self.session),
            refresher: authAPI,
            revoker: authAPI
        )
        let cacheResetAction = CacheResetAction {
            await recorder.record(.reset)
        }
        let store = SessionStore(
            coordinator: coordinator,
            userStore: UserStore(),
            signInAPI: authAPI,
            oauthRedirectURI: "cloudecode://auth/callback"
        )
        let worker = CacheResetWorker(
            cacheResetAction: cacheResetAction,
            authStatePublisher: store.authStatePublisher
        )
        worker.start()
        let startTask = Task { await store.start() }
        defer {
            startTask.cancel()
            worker.stop()
        }
        try await waitUntil { store.state == .signedIn(userId: "user-1") }

        await store.signOut()
        try await waitUntil { store.state == .signedOut }
        try await waitUntil { await recorder.events.contains(.reset) }

        let events = await recorder.events
        #expect(events.contains(.reset))
        #expect(events.contains(.revoke))
        #expect(events.filter { $0 == .reset }.count == 1)
    }

    @Test func rejectedRefreshAlsoResetsUserState() async throws {
        let recorder = SignOutEventRecorder()
        let authAPI = TestAuthAPI(
            session: Self.session,
            recorder: recorder,
            rejectsRefresh: true
        )
        let coordinator = TokenCoordinator(
            persistence: TestSessionPersistence(session: Self.session),
            refresher: authAPI,
            revoker: authAPI
        )
        let cacheResetAction = CacheResetAction {
            await recorder.record(.reset)
        }
        let store = SessionStore(
            coordinator: coordinator,
            userStore: UserStore(),
            signInAPI: authAPI,
            oauthRedirectURI: "cloudecode://auth/callback"
        )
        let worker = CacheResetWorker(
            cacheResetAction: cacheResetAction,
            authStatePublisher: store.authStatePublisher
        )
        worker.start()
        let startTask = Task { await store.start() }
        defer {
            startTask.cancel()
            worker.stop()
        }
        try await waitUntil { store.state == .signedIn(userId: "user-1") }

        _ = try? await coordinator.refresh()
        try await waitUntil { store.state == .signedOut }
        try await waitUntil { await recorder.events.contains(.reset) }

        #expect(await recorder.events == [.reset])
    }

    private static let session = Session(
        accessToken: "access-token",
        accessTokenExpiresAt: Date.now.addingTimeInterval(3_600),
        refreshToken: "refresh-token",
        refreshTokenExpiresAt: Date.now.addingTimeInterval(86_400),
        userId: "user-1"
    )

    private func waitUntil(
        _ condition: @MainActor () async -> Bool
    ) async throws {
        for _ in 0..<100 {
            if await condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        throw SessionStoreTestError.timedOut
    }
}

private final class TestSessionPersistence: SessionPersisting, @unchecked Sendable {
    private var session: Session?

    init(session: Session?) {
        self.session = session
    }

    func load() throws -> Session? {
        session
    }

    func save(_ session: Session) throws {
        self.session = session
    }

    func clear() throws {
        session = nil
    }
}

private actor TestAuthAPI: SignInProviding, SessionRefreshing, SessionRevoking {
    private let session: Session
    private let recorder: SignOutEventRecorder
    private let rejectsRefresh: Bool

    init(
        session: Session,
        recorder: SignOutEventRecorder,
        rejectsRefresh: Bool = false
    ) {
        self.session = session
        self.recorder = recorder
        self.rejectsRefresh = rejectsRefresh
    }

    func authorizePage(redirectUri: String) async throws -> AuthorizePage {
        throw SessionStoreTestError.unexpectedAPICall
    }

    func exchangeCode(code: String, state: String) async throws -> SignInResult {
        throw SessionStoreTestError.unexpectedAPICall
    }

    func refresh(refreshToken: String) async throws -> Session {
        if rejectsRefresh {
            throw APIError.unauthenticated
        }
        return session
    }

    func logout(refreshToken: String) async throws {
        await recorder.record(.revoke)
    }
}

private actor SignOutEventRecorder {
    enum Event: Equatable {
        case reset
        case revoke
    }

    private(set) var events: [Event] = []

    func record(_ event: Event) {
        events.append(event)
    }
}

private enum SessionStoreTestError: Error {
    case timedOut
    case unexpectedAPICall
}
