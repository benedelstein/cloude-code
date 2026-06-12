import API
import Entities
import Foundation

struct ArchiveSessionAction {
    let sessionsAPI: any SessionsAPIProviding
    let sessionSummaryStore: SessionSummaryStore

    @MainActor
    func callAsFunction(_ session: SessionSummaryModel) async throws {
        guard let sessionId = UUID(uuidString: session.id) else {
            throw SessionActionError.invalidSessionID
        }

        let snapshot = session.snapshot
        session.archived = true
        sessionSummaryStore.save([session])

        do {
            try await sessionsAPI.archive(sessionId: sessionId)
        } catch {
            sessionSummaryStore.putDisk([snapshot])
            throw error
        }
    }
}
