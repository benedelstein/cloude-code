import Entities
import NeedleFoundation
import SwiftUI

protocol AgentSessionDependency: Dependency {}

/// Child of `HomeComponent`: agent sessions can only be opened from the
/// authenticated Home screen.
final class AgentSessionComponent: Component<AgentSessionDependency> {
    private let session: SessionSummaryModel

    init(parent: Scope, session: SessionSummaryModel) {
        self.session = session
        super.init(parent: parent)
    }

    @MainActor
    var store: AgentSessionStore {
        shared {
            AgentSessionStore(session: session)
        }
    }
}

@MainActor
struct AgentSessionBuilder {
    let makeComponent: (SessionSummaryModel) -> AgentSessionComponent

    func build(session: SessionSummaryModel) -> some View {
        AgentSessionView(store: makeComponent(session).store)
    }
}
