import API
import Entities

struct RenameSessionAction {
    let sessionsAPI: any SessionsAPIProviding
    let sessionSummaryStore: SessionSummaryStore

    @MainActor
    func callAsFunction(_ session: SessionSummaryModel, title: String) async throws {
        let snapshot = session.snapshot
        session.title = title
        sessionSummaryStore.save([session])

        do {
            _ = try await sessionsAPI.updateTitle(sessionId: session.id, title: title)
        } catch {
            sessionSummaryStore.putSnapshotsToDisk([snapshot])
            throw error
        }
    }
}
