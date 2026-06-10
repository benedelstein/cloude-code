import API
import Entities
import NeedleFoundation
import SwiftUI

protocol HomeDependency: Dependency {
    var greetingAPI: any GreetingAPIProviding { get }
    var greetingCache: any GreetingCaching { get }
}

final class HomeComponent: Component<HomeDependency> {
    @MainActor
    var viewModel: HomeViewModel {
        shared {
            HomeViewModel(
                greetingAPI: dependency.greetingAPI,
                greetingCache: dependency.greetingCache
            )
        }
    }
}

@MainActor
struct HomeBuilder {
    let component: HomeComponent

    func build() -> some View {
        HomeView(viewModel: component.viewModel)
    }
}

extension EnvironmentValues {
    @Entry
    var homeBuilder: HomeBuilder?
}

struct HomeContainer: View {
    @Environment(\.homeBuilder) private var builder

    var body: some View {
        if let builder {
            builder.build()
        } else {
            ContentUnavailableView("Missing home builder", systemImage: "exclamationmark.triangle")
        }
    }
}
