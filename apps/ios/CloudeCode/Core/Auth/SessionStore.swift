import API
import AuthenticationServices
import Combine
import Domain
import Entities
import Foundation
import Observation
import SwiftUI

/// Auth state for the UI and the locally restored session's readiness.
@MainActor @Observable
final class SessionStore {
    enum State: Equatable {
        case loading
        case refreshing(userId: String)
        case signedIn(userId: String)
        case signedOut

        fileprivate var authUserId: String? {
            switch self {
            case .loading, .refreshing, .signedOut:
                nil
            case .signedIn(let userId):
                userId
            }
        }
    }

    private(set) var state: State = .loading {
        didSet {
            authStateSubject.send(state)
        }
    }
    private(set) var user: UserModel?
    private(set) var isSigningIn = false
    private(set) var signInError: String?
    private let coordinator: TokenCoordinator
    private let userStore: UserStore
    private let signInAPI: any SignInProviding
    private let oauthRedirectURI: String
    private let authStateSubject = CurrentValueSubject<State, Never>(.loading)
    private let didSignOutSubject = PassthroughSubject<Void, Never>()
    private var initialRefreshTask: Task<Void, Never>?

    var authStatePublisher: AnyPublisher<State, Never> {
        authStateSubject.eraseToAnyPublisher()
    }

    var authUserPublisher: AnyPublisher<String?, Never> {
        authStateSubject
            .map(\.authUserId)
            .removeDuplicates()
            .eraseToAnyPublisher()
    }

    var didSignOutPublisher: AnyPublisher<Void, Never> {
        didSignOutSubject.eraseToAnyPublisher()
    }

    init(
        coordinator: TokenCoordinator,
        userStore: UserStore,
        signInAPI: any SignInProviding,
        oauthRedirectURI: String
    ) {
        self.coordinator = coordinator
        self.userStore = userStore
        self.signInAPI = signInAPI
        self.oauthRedirectURI = oauthRedirectURI
    }

    func start() async {
        switch await coordinator.restore() {
        case .ready(let session):
            Logger.debug("Session restored for user", session.userId)
            state = .signedIn(userId: session.userId)
            user = try? await userStore.get([session.userId], scopes: .all).first
        case .needsRefresh(let session):
            Logger.debug("Session restored pending refresh for user", session.userId)
            state = .refreshing(userId: session.userId)
            startInitialRefresh()
            user = try? await userStore.get(
                [session.userId],
                scopes: [.memory, .disk]
            ).first
        case .signedOut:
            Logger.debug("No stored session; signed out")
            transitionToSignedOut()
        }

        for await event in coordinator.events {
            switch event {
            case .signedIn(let session):
                Logger.debug("Auth event: signedIn", session.userId)
                state = .signedIn(userId: session.userId)
                user = try? await userStore.get([session.userId], scopes: .all).first
            case .signedOut:
                Logger.debug("Auth event: signedOut")
                transitionToSignedOut()
                didSignOutSubject.send()
            case .refreshed(let session):
                Logger.debug("Auth event: refreshed")
                if case .refreshing = state {
                    Logger.debug("transitioning from refreshing to signedIn")
                    initialRefreshTask = nil
                    state = .signedIn(userId: session.userId)
                    user = try? await userStore.get([session.userId], scopes: .all).first
                }
            }
        }
    }

    func stop() {
        initialRefreshTask?.cancel()
        initialRefreshTask = nil
    }

    func signOut() async {
        guard state != .signedOut else { return }
        await coordinator.signOut()
    }

    private func transitionToSignedOut() {
        initialRefreshTask?.cancel()
        initialRefreshTask = nil
        user = nil
        state = .signedOut
    }

    private func startInitialRefresh() {
        initialRefreshTask?.cancel()
        initialRefreshTask = Task { [coordinator] in
            _ = try? await coordinator.refresh()
        }
    }

    /// GitHub OAuth via the system web-auth sheet: fetch the authorize URL,
    /// run OAuth and optional repository setup in one browser session, then
    /// complete and adopt the native token pair (the events loop flips state).
    func signIn(using webSession: WebAuthenticationSession) async {
        guard !isSigningIn else { return }
        isSigningIn = true
        signInError = nil
        defer { isSigningIn = false }
        var page: AuthorizePage?
        do {
            let authorizePage = try await signInAPI.authorizePage(redirectUri: oauthRedirectURI)
            page = authorizePage
            guard let scheme = URL(string: oauthRedirectURI)?.scheme else {
                preconditionFailure("invalid OAUTH_REDIRECT_URI: \(oauthRedirectURI)")
            }
            let callback = try await webSession.authenticate(
                using: authorizePage.url,
                callbackURLScheme: scheme
            )
            guard let callbackParameters = callbackParameters(from: callback, authorizePage: authorizePage) else {
                Logger.error("no state in auth callback response")
                signInError = "Sign-in failed. Please try again."
                return
            }
            let result = try await signInAPI.completeLogin(
                state: callbackParameters.state,
                token: callbackParameters.token
            )
            await coordinator.adopt(result.session)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // OAuth may already have completed before repository setup was
            // dismissed or left awaiting approval. Recover that login without
            // turning repository access into an authentication requirement.
            Logger.error("login canceled")
            guard let page, let continuationToken = page.continuationToken else { return }
            if let result = await recoverCompletedLogin(
                state: page.state,
                token: continuationToken
            ) {
                await coordinator.adopt(result.session)
            }
        } catch {
            Logger.error(error.localizedDescription)
            signInError = "Sign-in failed. Please try again."
        }
    }

    private func callbackParameters(
        from callback: URL,
        authorizePage: AuthorizePage
    ) -> (state: String, token: String)? {
        let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
        guard let returnedState = query?.first(where: { $0.name == "state" })?.value,
            returnedState == authorizePage.state,
            let continuationToken = authorizePage.continuationToken
        else {
            return nil
        }
        return (returnedState, continuationToken)
    }

    private func recoverCompletedLogin(state: String, token: String) async -> SignInResult? {
        try? await Task.retrying(
            maxAttempts: 3,
            backoff: .constant(.milliseconds(200)),
            priority: .userInitiated,
            shouldRetry: { _ in true },
            operation: { [signInAPI] in
                try await signInAPI.completeLogin(state: state, token: token)
            }
        ).value
    }
}
