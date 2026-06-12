import API
import Entities
import NeedleFoundation
import SwiftUI

protocol HomeDependency: Dependency {
    var sessionsAPI: any SessionsAPIProviding { get }
    @MainActor
    var sessionSummaryStore: SessionSummaryStore { get }
    var userSessionsSocket: UserSessionsSocket { get }
}

final class HomeComponent: Component<HomeDependency> {
    @MainActor
    var archiveSessionAction: ArchiveSessionAction {
        shared {
            ArchiveSessionAction(
                sessionsAPI: dependency.sessionsAPI,
                sessionSummaryStore: dependency.sessionSummaryStore
            )
        }
    }

    @MainActor
    var deleteSessionAction: DeleteSessionAction {
        shared {
            DeleteSessionAction(
                sessionsAPI: dependency.sessionsAPI,
                sessionSummaryStore: dependency.sessionSummaryStore
            )
        }
    }

    @MainActor
    var viewModel: HomeViewModel {
        shared {
            HomeViewModel(
                sessionsAPI: dependency.sessionsAPI,
                sessionSummaryStore: dependency.sessionSummaryStore,
                userSessionsSocket: dependency.userSessionsSocket,
                archiveSessionAction: archiveSessionAction,
                deleteSessionAction: deleteSessionAction
            )
        }
    }

    @MainActor
    func makeAgentSessionComponent(session: SessionSummaryModel) -> AgentSessionComponent {
        AgentSessionComponent(parent: self, session: session)
    }
}

@MainActor
struct HomeBuilder {
    let component: HomeComponent

    func build() -> some View {
        HomeView(
            viewModel: component.viewModel,
            sessionBuilder: AgentSessionBuilder { [component] session in
                component.makeAgentSessionComponent(session: session)
            }
        )
    }
}
