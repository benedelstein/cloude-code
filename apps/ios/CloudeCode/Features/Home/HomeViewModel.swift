import API
import CoreAPI
import Domain
import Foundation

struct HomeSessionGroup: Identifiable, Hashable {
    let repoId: Int
    let repoFullName: String
    var sessions: [HomeSessionRow]

    var id: Int { repoId }
}

struct HomeSessionRow: Identifiable, Hashable {
    let id: UUID
    let repoId: Int
    let title: String
    let repository: String
    let status: String
    let hasUnread: Bool

    init(summary: SessionSummary) {
        id = summary.id
        repoId = summary.repoId
        title = summary.title ?? "Untitled session"
        repository = summary.repoFullName
        status = summary.workingState.rawValue
        hasUnread = summary.hasUnread
    }
}

@MainActor
@Observable
final class HomeViewModel {
    private let sessionsAPI: any SessionsAPIProviding
    private let userSessionsSocket: UserSessionsSocket
    private var didStart = false
    private var hasConnected = false
    private var socketTask: Task<Void, Never>?

    private(set) var groups: [HomeSessionGroup] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    var isEmpty: Bool {
        groups.allSatisfy { $0.sessions.isEmpty }
    }

    init(sessionsAPI: any SessionsAPIProviding, userSessionsSocket: UserSessionsSocket) {
        self.sessionsAPI = sessionsAPI
        self.userSessionsSocket = userSessionsSocket
    }

    func start() async {
        guard !didStart else {
            return
        }
        didStart = true
        listenForSocketEvents()
        await refresh(showLoading: true)
        await userSessionsSocket.connect()
    }

    func refresh(showLoading: Bool = false) async {
        if showLoading {
            isLoading = true
        }
        errorMessage = nil
        do {
            let response = try await sessionsAPI.listSessions()
            groups = Self.groups(from: response.groups)
        } catch {
            Logger.error(error)
            errorMessage = error.localizedDescription
        }
        if showLoading {
            isLoading = false
        }
    }

    private func listenForSocketEvents() {
        socketTask = Task { [weak self, userSessionsSocket] in
            for await event in userSessionsSocket.events {
                await self?.handle(event)
            }
        }
    }

    private func handle(_ event: UserSessionsSocketEvent) async {
        switch event {
        case .connectionChanged(.connected):
            if hasConnected {
                await refresh()
            }
            hasConnected = true
        case .connectionChanged:
            break
        case .server(let message):
            await handle(message)
        }
    }

    private func handle(_ message: UserSessionsServerMessage) async {
        switch message {
        case .userSessionsConnected:
            break
        case .sessionSummaryCreated(let event):
            add(event.session)
        case .sessionSummaryUpdated(let event):
            replaceLoaded(event.session)
        case .sessionSummaryRemoved(let event):
            remove(sessionID: event.sessionId)
        case .sessionListResyncRequired:
            await refresh()
        case .unknown:
            break
        }
    }

    private func add(_ summary: SessionSummary) {
        let row = HomeSessionRow(summary: summary)
        remove(sessionID: row.id)
        guard let index = groups.firstIndex(where: { $0.repoId == row.repoId }) else {
            groups.insert(
                HomeSessionGroup(repoId: row.repoId, repoFullName: row.repository, sessions: [row]),
                at: 0
            )
            return
        }
        var group = groups.remove(at: index)
        group = HomeSessionGroup(
            repoId: group.repoId,
            repoFullName: row.repository,
            sessions: [row] + group.sessions
        )
        groups.insert(group, at: 0)
    }

    private func replaceLoaded(_ summary: SessionSummary) {
        let row = HomeSessionRow(summary: summary)
        for groupIndex in groups.indices {
            guard let sessionIndex = groups[groupIndex].sessions.firstIndex(where: { $0.id == row.id }) else {
                continue
            }
            groups[groupIndex].sessions[sessionIndex] = row
            return
        }
    }

    private func remove(sessionID: UUID) {
        groups = groups.compactMap { group in
            var nextGroup = group
            nextGroup.sessions.removeAll { $0.id == sessionID }
            return nextGroup.sessions.isEmpty ? nil : nextGroup
        }
    }

    private static func groups(from groups: [SessionRepoGroup]) -> [HomeSessionGroup] {
        groups.compactMap { group in
            let sessions = group.sessions.map(HomeSessionRow.init(summary:))
            guard !sessions.isEmpty else {
                return nil
            }
            return HomeSessionGroup(
                repoId: group.repoId,
                repoFullName: group.repoFullName,
                sessions: sessions
            )
        }
    }
}
