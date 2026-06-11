import API
import NeedleFoundation
import SwiftUI

protocol HomeDependency: Dependency {
    var sessionsAPI: any SessionsAPIProviding { get }
    var userSessionsSocket: UserSessionsSocket { get }
}

final class HomeComponent: Component<HomeDependency> {
    @MainActor
    var viewModel: HomeViewModel {
        shared {
            HomeViewModel(
                sessionsAPI: dependency.sessionsAPI,
                userSessionsSocket: dependency.userSessionsSocket
            )
        }
    }
}

@MainActor
struct HomeBuilder {
    let component: HomeComponent
    let sessionBuilder: SessionBuilder

    func build() -> some View {
        HomeView(viewModel: component.viewModel, sessionBuilder: sessionBuilder)
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
