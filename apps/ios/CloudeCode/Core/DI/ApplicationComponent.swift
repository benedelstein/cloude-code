import API
import Entities
import Foundation
import NeedleFoundation

protocol ApplicationDependency: Dependency {}

final class ApplicationComponent: Component<ApplicationDependency> {
    private var apiBaseURL: URL {
        // Injected per scheme via Config/*.xcconfig -> Info.plist.
        guard let string = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String,
              let url = URL(string: string) else {
            preconditionFailure("missing or invalid APIBaseURL in Info.plist")
        }
        return url
    }

    private var appGroupIdentifier: String {
        // Injected per scheme via Config/*.xcconfig -> Info.plist.
        guard let identifier = Bundle.main.object(forInfoDictionaryKey: "AppGroupIdentifier") as? String,
              !identifier.isEmpty else {
            preconditionFailure("missing AppGroupIdentifier in Info.plist")
        }
        return identifier
    }

    var apiClient: APIClient {
        shared {
            APIClient(baseURL: apiBaseURL) // pure transport
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
            SessionStore(coordinator: tokenCoordinator, userStore: userStore)
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

    var greetingAPI: any GreetingAPIProviding {
        shared {
            GreetingAPI()
        }
    }

    var greetingCache: any GreetingCaching {
        shared {
            GreetingCache()
        }
    }

    @MainActor
    var homeComponent: HomeComponent {
        shared {
            HomeComponent(parent: self)
        }
    }
}
