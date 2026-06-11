import Foundation

@MainActor
@Observable
final class SessionFeatureStore {
    let sessionID: String
    let title: String
    let repository: String
    let status: String

    init(session: SessionSummary) {
        sessionID = session.id
        title = session.title
        repository = session.repository
        status = session.status
    }
}
