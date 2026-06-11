import API
import AuthenticationServices
import Domain
import Entities
import Foundation
import Observation
import SwiftUI

/// Auth state for the UI: drives the root view's loading/signedIn/signedOut
/// switch and exposes the signed-in user.
@MainActor @Observable
final class SessionStore {
    enum State: Equatable {
        case loading
        case signedIn
        case signedOut
    }

    private(set) var state: State = .loading
    private(set) var user: UserModel?
    private(set) var isSigningIn = false
    private(set) var signInError: String?
    private let coordinator: TokenCoordinator
    private let userStore: UserStore
    private let signInAPI: any SignInProviding
    private let oauthRedirectURI: String

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
        if let session = await coordinator.restore() {
            state = .signedIn
            // Cache first, network if missing (UserStore cascade).
            user = try? await userStore.get([session.userId], scopes: .all).first
        } else {
            state = .signedOut
        }

        for await event in coordinator.events {
            switch event {
            case .signedIn(let session):
                state = .signedIn
                user = try? await userStore.get([session.userId], scopes: .all).first
            case .signedOut:
                user = nil
                state = .signedOut
            case .refreshed:
                break
            }
        }
    }

    func signOut() async {
        await coordinator.signOut()
    }

    /// GitHub OAuth via the system web-auth sheet: fetch the authorize URL,
    /// run the session, verify the echoed state, exchange the code for a
    /// native token pair, and adopt it (the events loop flips state).
    func signIn(using webSession: WebAuthenticationSession) async {
        guard !isSigningIn else { return }
        isSigningIn = true
        signInError = nil
        defer { isSigningIn = false }

        do {
            let page = try await signInAPI.authorizePage(redirectUri: oauthRedirectURI)
            guard let scheme = URL(string: oauthRedirectURI)?.scheme else {
                preconditionFailure("invalid OAUTH_REDIRECT_URI: \(oauthRedirectURI)")
            }
            let callback = try await webSession.authenticate(
                using: page.url,
                callbackURLScheme: scheme
            )
            let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
            guard
                let code = query?.first(where: { $0.name == "code" })?.value,
                let returnedState = query?.first(where: { $0.name == "state" })?.value,
                returnedState == page.state
            else {
                signInError = "Sign-in failed. Please try again."
                return
            }
            let result = try await signInAPI.exchangeCode(code: code, state: returnedState)
            await coordinator.adopt(result.session)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // User dismissed the sheet — not an error.
        } catch {
            signInError = "Sign-in failed. Please try again."
        }
    }

    #if DEBUG
    /// Adopts a placeholder session with an already-stale access token, then
    /// refreshes so real tokens replace the placeholder immediately.
    func injectDevSession(refreshToken: String, userId: String) async {
        let placeholder = Session(
            accessToken: "",
            accessTokenExpiresAt: .distantPast,
            refreshToken: refreshToken,
            refreshTokenExpiresAt: Date().addingTimeInterval(60 * 24 * 60 * 60),
            userId: userId
        )
        await coordinator.adopt(placeholder)
        try? await coordinator.refresh()
    }
    #endif
}
