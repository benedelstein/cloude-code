import API
import AuthenticationServices
import Foundation
import Observation
import SwiftUI

/// Presents GitHub App repository settings and validates the native callback.
@MainActor @Observable
final class GitHubInstallationStore {
    enum State: Equatable {
        case idle
        case installing
        case failed(String)
    }

    private(set) var state: State = .idle
    private let authAPI: any AuthAPIProviding
    private let oauthRedirectURI: String

    init(
        authAPI: any AuthAPIProviding,
        oauthRedirectURI: String
    ) {
        self.authAPI = authAPI
        self.oauthRedirectURI = oauthRedirectURI
    }

    /// Opens GitHub repository settings and validates its callback when one is returned.
    func install(using webSession: WebAuthenticationSession) async {
        guard state != .installing else { return }
        state = .installing

        do {
            let page = try await authAPI.githubInstallationPage(redirectUri: oauthRedirectURI)
            guard let scheme = URL(string: oauthRedirectURI)?.scheme else {
                preconditionFailure("invalid OAUTH_REDIRECT_URI: \(oauthRedirectURI)")
            }
            let callback = try await webSession.authenticate(
                using: page.url,
                callbackURLScheme: scheme
            )
            let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
            guard query?.first(where: { $0.name == "state" })?.value == page.state else {
                state = .failed("GitHub returned an invalid installation response.")
                return
            }

            state = .idle
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            state = .idle
        } catch {
            state = .failed("Couldn't finish GitHub repository setup.")
        }
    }
}
