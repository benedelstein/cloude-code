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

    /// GitHub sign-in through the system web-auth sheet.
    ///
    /// The server owns the flow: one presentation covers OAuth and, when the
    /// user has no GitHub App installation, repository setup. The app only
    /// starts an attempt and claims the completed identity. Attempt
    /// credentials stay in this function's memory; nothing is persisted, so a
    /// process termination simply abandons the attempt.
    func signIn(using webSession: some WebAuthenticating) async {
        guard !isSigningIn else { return }
        isSigningIn = true
        signInError = nil
        defer { isSigningIn = false }
        var startedAttempt: GitHubSignInAttempt?
        do {
            let attempt = try await signInAPI.startSignIn(redirectUri: oauthRedirectURI)
            startedAttempt = attempt
            guard let scheme = URL(string: oauthRedirectURI)?.scheme else {
                preconditionFailure("invalid OAUTH_REDIRECT_URI: \(oauthRedirectURI)")
            }
            let callback = try await webSession.authenticate(
                using: attempt.authorizeURL,
                callbackURLScheme: scheme
            )
            let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
            guard query?.first(where: { $0.name == "attemptId" })?.value == attempt.attemptId else {
                Logger.error("sign-in callback did not match the started attempt")
                signInError = "Sign-in failed. Please try again."
                return
            }
            if let callbackError = query?.first(where: { $0.name == "error" })?.value {
                Logger.error("sign-in callback reported \(callbackError)")
                signInError = "Sign-in failed. Please try again."
                return
            }
            let result = try await signInAPI.completeSignIn(
                attemptId: attempt.attemptId,
                claimToken: attempt.claimToken
            )
            await coordinator.adopt(result.session)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // OAuth may already have completed before repository setup was
            // dismissed or left awaiting approval. Recover that login without
            // turning repository access into an authentication requirement.
            Logger.debug("web-auth session dismissed")
            guard let startedAttempt else { return }
            await recoverDismissedSignIn(startedAttempt)
        } catch {
            Logger.error(error.localizedDescription)
            signInError = "Sign-in failed. Please try again."
        }
    }

    /// Claims an attempt after the browser was dismissed.
    ///
    /// `SIGN_IN_NOT_READY` means the attempt is still awaiting OAuth. That is
    /// normally an ordinary cancellation, so it stays silent — but the OAuth
    /// callback can also still be in flight, hence the short bounded retry.
    private func recoverDismissedSignIn(_ attempt: GitHubSignInAttempt) async {
        for remainingAttempts in stride(from: Self.notReadyRetryCount, through: 0, by: -1) {
            do {
                let result = try await signInAPI.completeSignIn(
                    attemptId: attempt.attemptId,
                    claimToken: attempt.claimToken
                )
                await coordinator.adopt(result.session)
                return
            } catch let error as APIError where error.isSignInNotReady {
                guard remainingAttempts > 0 else { return }
                try? await Task.sleep(for: .milliseconds(200))
            } catch {
                Logger.error(error.localizedDescription)
                signInError = "Sign-in failed. Please try again."
                return
            }
        }
    }

    private static let notReadyRetryCount = 2
}
