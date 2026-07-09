import API
import Entities
import NeedleFoundation
import SwiftUI

protocol HomeDependency: Dependency {
    var sessionsAPI: any SessionsAPIProviding { get }
    var reposAPI: any ReposAPIProviding { get }
    var modelsAPI: any ModelsAPIProviding { get }
    @MainActor
    var notificationHandler: NotificationHandler { get }
    @MainActor
    var sessionSummaryStore: SessionSummaryStore { get }
    @MainActor
    var newSessionPreferences: NewSessionPreferences { get }
    var cache: Cache { get }
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
    var router: HomeRouter {
        shared {
            HomeRouter(
                notificationHandler: dependency.notificationHandler,
                sessionSummaryStore: dependency.sessionSummaryStore
            )
        }
    }

    @MainActor
    var sessionMessageStore: SessionMessageStore {
        shared {
            SessionMessageStore(cache: dependency.cache)
        }
    }

    @MainActor
    func makeAgentSessionComponent(session: SessionSummaryModel) -> AgentSessionComponent {
        AgentSessionComponent(parent: self, session: session)
    }

    @MainActor
    func makeNewAgentSessionComponent() -> AgentSessionComponent {
        AgentSessionComponent(parent: self, session: nil)
    }
}

@MainActor
struct HomeBuilder {
    let component: HomeComponent

    func build() -> some View {
        HomeView(
            viewModel: component.viewModel,
            router: component.router,
            sessionBuilder: AgentSessionBuilder { [component] session in
                if let session {
                    component.makeAgentSessionComponent(session: session)
                } else {
                    component.makeNewAgentSessionComponent()
                }
            }
        )
    }
}
