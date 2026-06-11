import Foundation

@MainActor
@Observable
final class SessionFeatureStore {
    let sessionID: UUID
    let title: String
    let repository: String
    let status: String

    init(session: HomeSessionRow) {
        sessionID = session.id
        title = session.title
        repository = session.repository
        status = session.status
    }
}
