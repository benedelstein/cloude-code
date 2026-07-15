import API
@testable import CloudeCode
import Combine
import Domain
import Entities
import Foundation
import Testing

@Suite("Session store sign-out")
@MainActor
struct SessionStoreTests {
    @Test func explicitSignOutClearsAndRevokesSession() async throws {
        let recorder = SignOutEventRecorder()
        let authAPI = TestAuthAPI(session: Self.session, recorder: recorder)
        let coordinator = TokenCoordinator(
            persistence: TestSessionPersistence(session: Self.session),
            refresher: authAPI,
            revoker: authAPI
        )
        let store = SessionStore(
            coordinator: coordinator,
            userStore: UserStore(),
            signInAPI: authAPI,
            oauthRedirectURI: "cloudecode://auth/callback"
        )
        let signOutCounter = SignOutCounter()
        let cancellable = store.didSignOutPublisher.sink {
            MainActor.assumeIsolated { signOutCounter.count += 1 }
        }
        defer { cancellable.cancel() }
        let startTask = Task { await store.start() }
        defer { startTask.cancel() }
        try await waitUntil { store.state == .signedIn(userId: "user-1") }

        await store.signOut()
        try await waitUntil { store.state == .signedOut }
        #expect(await recorder.events == [.revoke])
        #expect(signOutCounter.count == 1)
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
        let store = SessionStore(
            coordinator: coordinator,
            userStore: UserStore(),
            signInAPI: authAPI,
            oauthRedirectURI: "cloudecode://auth/callback"
        )
        let signOutCounter = SignOutCounter()
        let cancellable = store.didSignOutPublisher.sink {
            MainActor.assumeIsolated { signOutCounter.count += 1 }
        }
        defer { cancellable.cancel() }
        let startTask = Task { await store.start() }
        defer { startTask.cancel() }
        try await waitUntil { store.state == .signedIn(userId: "user-1") }

        _ = try? await coordinator.refresh()
        try await waitUntil { store.state == .signedOut }
        #expect(await recorder.events.isEmpty)
        #expect(signOutCounter.count == 1)
    }

    @Test func ordinarySignedOutLaunchDoesNotPublishSignOut() async throws {
        let recorder = SignOutEventRecorder()
        let authAPI = TestAuthAPI(session: Self.session, recorder: recorder)
        let coordinator = TokenCoordinator(
            persistence: TestSessionPersistence(session: nil),
            refresher: authAPI,
            revoker: authAPI
        )
        let store = SessionStore(
            coordinator: coordinator,
            userStore: UserStore(),
            signInAPI: authAPI,
            oauthRedirectURI: "cloudecode://auth/callback"
        )
        let signOutCounter = SignOutCounter()
        let cancellable = store.didSignOutPublisher.sink {
            MainActor.assumeIsolated { signOutCounter.count += 1 }
        }
        defer { cancellable.cancel() }
        let startTask = Task { await store.start() }
        defer { startTask.cancel() }

        try await waitUntil { store.state == .signedOut }

        #expect(signOutCounter.count == .zero)
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

@MainActor
private final class SignOutCounter {
    var count = 0
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
