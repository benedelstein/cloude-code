import API
import CoreAPI
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
            let response = try await sessionsAPI.updateTitle(sessionId: session.id, title: trimmedTitle)
            if response.title != trimmedTitle {
                session.title = response.title
                sessionSummaryStore.save([session])
            }
        } catch {
            sessionSummaryStore.putSnapshotsToDisk([snapshot])
            throw error
        }
    }
}
