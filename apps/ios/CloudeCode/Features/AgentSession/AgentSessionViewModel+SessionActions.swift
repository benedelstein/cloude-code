import Domain
import Foundation

extension AgentSessionViewModel {
    /// Archives the current session. Returns `true` on success so the caller
    /// can pop back to the sessions list.
    @discardableResult
    func archiveCurrentSession() async -> Bool {
        guard let session else {
            return false
        }
        errorMessage = nil
        do {
            try await archiveSessionAction(session)
            return true
        } catch {
            Logger.error(error)
            errorMessage = error.localizedDescription
            return false
        }
    }

    /// Deletes the current session. Returns `true` on success so the caller
    /// can pop back to the sessions list.
    @discardableResult
    func deleteCurrentSession() async -> Bool {
        guard let session else {
            return false
        }
        errorMessage = nil
        do {
            try await deleteSessionAction(session)
            return true
        } catch {
            Logger.error(error)
            errorMessage = error.localizedDescription
            return false
        }
    }

    func renameCurrentSession(to newTitle: String) async {
        guard let session else {
            return
        }
        let trimmed = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != session.title else {
            return
        }
        errorMessage = nil
        do {
            try await renameSessionAction(session, title: trimmed)
        } catch {
            Logger.error(error)
            errorMessage = error.localizedDescription
        }
    }
}
