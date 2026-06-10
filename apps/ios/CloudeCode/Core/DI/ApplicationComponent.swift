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

    var apiClient: APIClient {
        shared {
            APIClient(baseURL: apiBaseURL)
        }
    }

    var authAPI: any AuthAPIProviding {
        shared {
            AuthAPI(client: apiClient)
        }
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
