import API
import Entities

struct DeleteSessionAction {
    let sessionsAPI: any SessionsAPIProviding
    let sessionSummaryStore: SessionSummaryStore

    @MainActor
    func callAsFunction(_ session: SessionSummaryModel) async throws {
        let snapshot = session.snapshot
        sessionSummaryStore.delete([session.id])

        do {
            try await sessionsAPI.delete(sessionId: session.id)
        } catch {
            sessionSummaryStore.putDisk([snapshot])
            throw error
        }
    }
}
