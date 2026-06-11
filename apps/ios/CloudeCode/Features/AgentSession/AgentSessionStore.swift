import Entities
import Foundation

@MainActor
@Observable
final class AgentSessionStore {
    /// Canonical cached model — updates from the cache/socket propagate here.
    let session: SessionSummaryModel

    init(session: SessionSummaryModel) {
        self.session = session
    }
}
