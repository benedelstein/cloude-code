import API
import Entities
import Foundation

struct DeleteSessionAction {
    let sessionsAPI: any SessionsAPIProviding
    let sessionSummaryStore: SessionSummaryStore

    @MainActor
    func callAsFunction(_ session: SessionSummaryModel) async throws {
        guard let sessionId = UUID(uuidString: session.id) else {
            throw SessionActionError.invalidSessionID
        }

        let snapshot = session.snapshot
        sessionSummaryStore.delete([session.id])

        do {
            try await sessionsAPI.delete(sessionId: sessionId)
        } catch {
            sessionSummaryStore.putDisk([snapshot])
            throw error
        }
    }
}
