import API
import Cache
import NeedleFoundation

protocol ApplicationDependency: Dependency {}

final class ApplicationComponent: Component<ApplicationDependency> {
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
