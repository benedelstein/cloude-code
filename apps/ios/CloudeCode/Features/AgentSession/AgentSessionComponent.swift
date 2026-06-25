import API
import Entities
import NeedleFoundation
import SwiftUI

protocol AgentSessionDependency: Dependency {
    func makeSessionSocket(sessionId: String) -> SessionSocket

    var fetchImageAction: any FetchImageAction { get }

    @MainActor
    var sessionMessageStore: SessionMessageStore { get }
}

/// Child of `HomeComponent`: agent sessions can only be opened from the
/// authenticated Home screen.
final class AgentSessionComponent: Component<AgentSessionDependency> {
    private let session: SessionSummaryModel

    init(parent: Scope, session: SessionSummaryModel) {
        self.session = session
        super.init(parent: parent)
    }

    @MainActor
    private var transcriptBuilder: any AgentSessionTranscriptBuilding {
        shared {
            AgentSessionTranscriptBuilder()
        }
    }

    @MainActor
    var store: AgentSessionViewModel {
        shared {
            AgentSessionViewModel(
                session: session,
                socket: dependency.makeSessionSocket(sessionId: session.id),
                sessionMessageStore: dependency.sessionMessageStore,
                transcriptBuilder: transcriptBuilder
            )
        }
    }

    var fetchImageAction: any FetchImageAction {
        dependency.fetchImageAction
    }
}

@MainActor
struct AgentSessionBuilder {
    let makeComponent: (SessionSummaryModel) -> AgentSessionComponent

    func build(session: SessionSummaryModel) -> some View {
        let component = makeComponent(session)
        return AgentSessionView(store: component.store)
            .environment(\.fetchImageAction, component.fetchImageAction)
    }
}
