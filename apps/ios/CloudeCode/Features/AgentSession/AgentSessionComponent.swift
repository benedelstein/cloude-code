import API
import Entities
import Foundation
import NeedleFoundation
import SwiftUI

protocol AgentSessionDependency: Dependency {
    func makeSessionSocket(sessionId: UUID) -> SessionSocket
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
    var store: AgentSessionStore {
        shared {
            guard let sessionId = UUID(uuidString: session.id) else {
                preconditionFailure("Invalid session id: \(session.id)")
            }
            return AgentSessionStore(
                session: session,
                socket: dependency.makeSessionSocket(sessionId: sessionId)
            )
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
