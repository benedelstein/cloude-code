import API
import Entities
import Foundation
import NeedleFoundation

protocol ApplicationDependency: Dependency {}

final class ApplicationComponent: Component<ApplicationDependency> {
    private var apiBaseURL: URL {
        // Injected per scheme via Config/*.xcconfig -> Info.plist.
        guard let string = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
              let url = URL(string: string) else {
            preconditionFailure("missing or invalid API_BASE_URL in Info.plist")
        }
        return url
    }

    private var appGroupIdentifier: String {
        // Injected per scheme via Config/*.xcconfig -> Info.plist.
        guard let identifier = Bundle.main.object(forInfoDictionaryKey: "APP_GROUP_IDENTIFIER") as? String,
              !identifier.isEmpty else {
            preconditionFailure("missing APP_GROUP_IDENTIFIER in Info.plist")
        }
        return identifier
    }

    private var oauthRedirectURI: String {
        // Injected per scheme via Config/*.xcconfig -> Info.plist.
        guard let uri = Bundle.main.object(forInfoDictionaryKey: "OAUTH_REDIRECT_URI") as? String,
              !uri.isEmpty else {
            preconditionFailure("missing OAUTH_REDIRECT_URI in Info.plist")
        }
        return uri
    }

    var apiClient: APIClient {
        shared {
            APIClient(baseURL: apiBaseURL) // pure transport
        }
    }

    var signInAPI: any SignInProviding {
        shared {
            SignInAPI(client: apiClient)
        }
    }

    var tokenCoordinator: TokenCoordinator {
        shared {
            TokenCoordinator(
                persistence: KeychainSessionPersistence(appGroup: appGroupIdentifier),
                refresher: SessionRefreshAPI(client: apiClient) // no provider — no cycle
            )
        }
    }

    var authAPI: any AuthAPIProviding {
        shared {
            AuthAPI(client: apiClient, tokenProvider: tokenCoordinator)
        }
    }

    var sessionsAPI: any SessionsAPIProviding {
        shared {
            SessionsAPI(client: apiClient, tokenProvider: tokenCoordinator)
        }
    }

    @MainActor var sessionStore: SessionStore {
        shared {
            SessionStore(
                coordinator: tokenCoordinator,
                userStore: userStore,
                signInAPI: signInAPI,
                oauthRedirectURI: oauthRedirectURI
            )
        }
    }

    /// Sidebar session-list updates stream. Shared: one socket per app.
    var userSessionsSocket: UserSessionsSocket {
        shared {
            UserSessionsSocket(
                baseURL: apiBaseURL,
                tokenCache: WebSocketTokenCache { [sessionsAPI] in
                    try await sessionsAPI.userSessionsWebSocketToken()
                }
            )
        }
    }

    /// Per-session chat stream. Not shared: each open session owns a socket.
    func makeSessionSocket(sessionId: UUID) -> SessionSocket {
        SessionSocket(
            baseURL: apiBaseURL,
            sessionId: sessionId,
            tokenCache: WebSocketTokenCache { [sessionsAPI] in
                try await sessionsAPI.sessionWebSocketToken(sessionId: sessionId)
            }
        )
    }

    var cache: Cache {
        shared {
            do {
                return try Cache(container: ModelContainerFactory().make())
            } catch {
                preconditionFailure("failed to create cache container: \(error)")
            }
        }
    }

    @MainActor var userStore: UserStore {
        shared {
            UserStore(cache: cache) { [authAPI] _ in
                // /auth/me is the only user source today; ids are ignored.
                try await [authAPI.me()]
            }
        }
    }

    @MainActor var sessionSummaryStore: SessionSummaryStore {
        shared {
            SessionSummaryStore(cache: cache)
        }
    }

    @MainActor
    var homeComponent: HomeComponent {
        shared {
            HomeComponent(parent: self)
        }
    }
}
