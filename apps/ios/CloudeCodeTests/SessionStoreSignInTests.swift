import API
import AuthenticationServices
@testable import CloudeCode
import Domain
import Entities
import Foundation
import Testing

@Suite("Session store GitHub sign-in")
@MainActor
struct SessionStoreSignInTests {
    @Test func matchingCallbackClaimsTheAttemptAndAdoptsTheSession() async throws {
        let api = TestSignInAPI(result: Self.signInResult)
        let store = makeStore(api: api)
        let startTask = Task { await store.start() }
        defer { startTask.cancel() }
        try await waitUntil { store.state == .signedOut }

        await store.signIn(using: TestWebAuthenticationSession(
            outcome: .callback(try testURL(Self.callbackURLString(attemptId: Self.attemptId)))
        ))

        #expect(await api.completions == [
            Completion(attemptId: Self.attemptId, claimToken: Self.claimToken)
        ])
        #expect(store.signInError == nil)
        try await waitUntil { store.state == .signedIn(userId: "user-1") }
    }

    @Test func mismatchedCallbackAttemptIdIsRejectedWithoutClaiming() async throws {
        let api = TestSignInAPI(result: Self.signInResult)
        let store = makeStore(api: api)
        let startTask = Task { await store.start() }
        defer { startTask.cancel() }
        try await waitUntil { store.state == .signedOut }

        await store.signIn(using: TestWebAuthenticationSession(
            outcome: .callback(try testURL(Self.callbackURLString(attemptId: "some-other-attempt")))
        ))

        #expect(await api.completions.isEmpty)
        #expect(store.signInError != nil)
        #expect(store.state == .signedOut)
    }

    @Test func oauthDenialCallbackSurfacesARetryableError() async throws {
        let api = TestSignInAPI(result: Self.signInResult)
        let store = makeStore(api: api)
        let startTask = Task { await store.start() }
        defer { startTask.cancel() }
        try await waitUntil { store.state == .signedOut }

        await store.signIn(using: TestWebAuthenticationSession(
            outcome: .callback(try testURL(Self.callbackURLString(
                attemptId: Self.attemptId,
                error: "OAUTH_DENIED"
            )))
        ))

        #expect(await api.completions.isEmpty)
        #expect(store.signInError != nil)
        #expect(store.state == .signedOut)
    }

    @Test func dismissalAfterOAuthStillAdoptsTheIdentityReadySession() async throws {
        let api = TestSignInAPI(result: Self.signInResult)
        let store = makeStore(api: api)
        let startTask = Task { await store.start() }
        defer { startTask.cancel() }
        try await waitUntil { store.state == .signedOut }

        await store.signIn(using: TestWebAuthenticationSession(outcome: .canceled))

        #expect(await api.completions.count == 1)
        #expect(store.signInError == nil)
        try await waitUntil { store.state == .signedIn(userId: "user-1") }
    }

    @Test func dismissalBeforeOAuthStaysSignedOutWithoutAnError() async throws {
        let api = TestSignInAPI(result: Self.signInResult, notReadyResponses: .max)
        let store = makeStore(api: api)
        let startTask = Task { await store.start() }
        defer { startTask.cancel() }
        try await waitUntil { store.state == .signedOut }

        await store.signIn(using: TestWebAuthenticationSession(outcome: .canceled))

        #expect(store.signInError == nil)
        #expect(store.state == .signedOut)
        // Bounded: the not-ready path must not retry indefinitely.
        #expect(await api.completions.count == 3)
    }

    @Test func notReadyRetriesBrieflyWhileTheOAuthCallbackLands() async throws {
        let api = TestSignInAPI(result: Self.signInResult, notReadyResponses: 1)
        let store = makeStore(api: api)
        let startTask = Task { await store.start() }
        defer { startTask.cancel() }
        try await waitUntil { store.state == .signedOut }

        await store.signIn(using: TestWebAuthenticationSession(outcome: .canceled))

        #expect(await api.completions.count == 2)
        #expect(store.signInError == nil)
        try await waitUntil { store.state == .signedIn(userId: "user-1") }
    }

    @Test func invalidAttemptOnDismissalSurfacesARetryableError() async throws {
        let api = TestSignInAPI(
            result: Self.signInResult,
            completionError: APIError.httpError(
                statusCode: 400,
                code: "INVALID_SIGN_IN_ATTEMPT",
                message: "Invalid or expired sign-in attempt. Try again."
            )
        )
        let store = makeStore(api: api)
        let startTask = Task { await store.start() }
        defer { startTask.cancel() }
        try await waitUntil { store.state == .signedOut }

        await store.signIn(using: TestWebAuthenticationSession(outcome: .canceled))

        #expect(store.signInError != nil)
        #expect(store.state == .signedOut)
    }

    private func makeStore(api: TestSignInAPI) -> SessionStore {
        SessionStore(
            coordinator: TokenCoordinator(
                persistence: NoSessionPersistence(),
                refresher: api,
                revoker: api
            ),
            userStore: UserStore(),
            signInAPI: api,
            oauthRedirectURI: "cloudecode://auth/callback"
        )
    }

    fileprivate static let attemptId = "attempt-1"
    fileprivate static let claimToken = "claim-token"

    fileprivate static func callbackURLString(attemptId: String, error: String? = nil) -> String {
        let errorQuery = error.map { "&error=\($0)" } ?? ""
        return "cloudecode://auth/callback?attemptId=\(attemptId)\(errorQuery)"
    }

    private static let signInResult = SignInResult(
        session: Session(
            accessToken: "access-token",
            accessTokenExpiresAt: Date.now.addingTimeInterval(3_600),
            refreshToken: "refresh-token",
            refreshTokenExpiresAt: Date.now.addingTimeInterval(86_400),
            userId: "user-1"
        ),
        user: Domain.User(id: "user-1", login: "octocat", name: nil, avatarUrl: nil)
    )

    private func waitUntil(
        _ condition: @MainActor () async -> Bool
    ) async throws {
        for _ in 0..<200 {
            if await condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        throw SessionStoreSignInTestError.timedOut
    }
}

private struct Completion: Equatable, Sendable {
    let attemptId: String
    let claimToken: String
}

private struct TestWebAuthenticationSession: WebAuthenticating {
    enum Outcome {
        case callback(URL)
        case canceled
    }

    let outcome: Outcome

    func authenticate(using url: URL, callbackURLScheme: String) async throws -> URL {
        switch outcome {
        case .callback(let callback):
            return callback
        case .canceled:
            throw ASWebAuthenticationSessionError(.canceledLogin)
        }
    }
}

private actor TestSignInAPI: SignInProviding, SessionRefreshing, SessionRevoking {
    private let result: SignInResult
    private let completionError: (any Error)?
    private var notReadyResponses: Int
    private(set) var completions: [Completion] = []

    init(
        result: SignInResult,
        notReadyResponses: Int = 0,
        completionError: (any Error)? = nil
    ) {
        self.result = result
        self.notReadyResponses = notReadyResponses
        self.completionError = completionError
    }

    func startSignIn(redirectUri: String) async throws -> GitHubSignInAttempt {
        try GitHubSignInAttempt(
            authorizeURL: testURL("https://github.test/authorize"),
            attemptId: SessionStoreSignInTests.attemptId,
            claimToken: SessionStoreSignInTests.claimToken
        )
    }

    func completeSignIn(attemptId: String, claimToken: String) async throws -> SignInResult {
        completions.append(Completion(attemptId: attemptId, claimToken: claimToken))
        if let completionError {
            throw completionError
        }
        if notReadyResponses > 0 {
            notReadyResponses -= 1
            throw APIError.httpError(
                statusCode: 409,
                code: "SIGN_IN_NOT_READY",
                message: "Sign-in is not ready yet."
            )
        }
        return result
    }

    func refresh(refreshToken: String) async throws -> Session {
        throw SessionStoreSignInTestError.unexpectedAPICall
    }

    func logout(refreshToken: String) async throws {}
}

private final class NoSessionPersistence: SessionPersisting, @unchecked Sendable {
    private var session: Session?

    func load() throws -> Session? { session }

    func save(_ session: Session) throws { self.session = session }

    func clear() throws { session = nil }
}

/// Keeps test fixtures free of force unwraps.
private func testURL(_ string: String) throws -> URL {
    guard let url = URL(string: string) else {
        throw SessionStoreSignInTestError.invalidURL
    }
    return url
}

private enum SessionStoreSignInTestError: Error {
    case timedOut
    case unexpectedAPICall
    case invalidURL
}
