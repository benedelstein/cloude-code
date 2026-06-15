import API
import Entities

struct ArchiveSessionAction {
    let sessionsAPI: any SessionsAPIProviding
    let sessionSummaryStore: SessionSummaryStore

    @MainActor
    func callAsFunction(_ session: SessionSummaryModel) async throws {
        let snapshot = session.snapshot
        session.archived = true
        sessionSummaryStore.save([session])

        do {
            try await sessionsAPI.archive(sessionId: session.id)
        } catch {
            sessionSummaryStore.putDisk([snapshot])
            throw error
        }
    }
}
