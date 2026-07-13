import API
import Entities
import Foundation

struct RenameSessionAction {
    let sessionsAPI: any SessionsAPIProviding
    let sessionSummaryStore: SessionSummaryStore

    @MainActor
    func callAsFunction(_ session: SessionSummaryModel, title: String) async throws {
        let snapshot = session.snapshot
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        session.title = trimmedTitle
        sessionSummaryStore.save([session])

        do {
            // The server reconciles the canonical summary out-of-band via the
            // `session.summary.updated` websocket event, so we only need to
            // confirm the write succeeded here.
            try await sessionsAPI.updateTitle(sessionId: session.id, title: trimmedTitle)
        } catch {
            sessionSummaryStore.putSnapshotsToDisk([snapshot])
            throw error
        }
    }
}
