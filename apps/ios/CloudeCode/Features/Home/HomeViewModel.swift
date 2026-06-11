import API
import CoreAPI
import Entities
import Domain
import Foundation

struct HomeSessionGroup: Identifiable, Hashable {
    let repoId: Int
    let repoFullName: String
    var sessions: [SessionSummary]

    var id: Int { repoId }
}

struct SessionSummary: Identifiable, Hashable {
    let id: String
    let repoId: Int
    let title: String
    let repository: String
    let status: String
    let hasUnread: Bool
    let createdAt: String

    @MainActor
    init(summary: SessionSummaryModel) {
        id = summary.id
        repoId = summary.repoId
        title = summary.title ?? "Untitled session"
        repository = summary.repoFullName
        status = summary.workingState
        hasUnread = summary.hasUnread
        createdAt = summary.createdAt
    }
}

@MainActor
@Observable
final class HomeViewModel {
    private let sessionsAPI: any SessionsAPIProviding
    private let sessionSummaryStore: SessionSummaryStore
    private let userSessionsSocket: UserSessionsSocket
    private let homeSessionEventHub: HomeSessionEventHub
    private var didStart = false
    private var hasConnected = false
    private var socketTask: Task<Void, Never>?
    private var localEventTask: Task<Void, Never>?

    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var nextRepoCursor: String?

    var groups: [HomeSessionGroup] {
        Self.groups(from: Array(sessionSummaryStore.objectMap.values))
    }

    var isEmpty: Bool {
        groups.allSatisfy { $0.sessions.isEmpty }
    }

    init(
        sessionsAPI: any SessionsAPIProviding,
        sessionSummaryStore: SessionSummaryStore,
        userSessionsSocket: UserSessionsSocket,
        homeSessionEventHub: HomeSessionEventHub
    ) {
        self.sessionsAPI = sessionsAPI
        self.sessionSummaryStore = sessionSummaryStore
        self.userSessionsSocket = userSessionsSocket
        self.homeSessionEventHub = homeSessionEventHub
    }

    func start() async {
        guard !didStart else {
            return
        }
        didStart = true
        listenForSocketEvents()
        listenForLocalEvents()
        await loadCache()
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
            replaceCachedList(with: response)
        } catch {
            Logger.error(error)
            errorMessage = error.localizedDescription
        }
        if showLoading {
            isLoading = false
        }
    }

    private func loadCache() async {
        do {
            _ = try await sessionSummaryStore.load()
        } catch {
            Logger.error(error)
        }
    }

    private func listenForSocketEvents() {
        socketTask = Task { [weak self, userSessionsSocket] in
            for await event in userSessionsSocket.events {
                await self?.handle(event)
            }
        }
    }

    private func listenForLocalEvents() {
        localEventTask = Task { [weak self, homeSessionEventHub] in
            for await event in await homeSessionEventHub.events() {
                self?.handle(event)
            }
        }
    }

    private func handle(_ event: HomeSessionEvent) {
        switch event {
        case .created(let session):
            add(session)
        case .updated(let session):
            replaceLoaded(session)
        case .removed(let sessionID):
            remove(sessionID: sessionID.uuidString)
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
            remove(sessionID: event.sessionId.uuidString)
        case .sessionListResyncRequired:
            await refresh()
        case .unknown:
            break
        }
    }

    private func add(_ summary: CoreAPI.SessionSummary) {
        sessionSummaryStore.putDisk([summary.domainSummary])
    }

    private func replaceLoaded(_ summary: CoreAPI.SessionSummary) {
        guard sessionSummaryStore[summary.id.uuidString] != nil else {
            return
        }
        sessionSummaryStore.putDisk([summary.domainSummary])
    }

    private func remove(sessionID: String) {
        sessionSummaryStore.delete([sessionID])
    }

    private func replaceCachedList(with response: ListSessionsResponse) {
        nextRepoCursor = response.nextRepoCursor
        let summaries = response.groups.flatMap(\.sessions).map(\.domainSummary)
        let freshIDs = Set(summaries.map(\.id))
        let staleIDs = Set(sessionSummaryStore.objectMap.keys).subtracting(freshIDs)
        sessionSummaryStore.delete(staleIDs)
        sessionSummaryStore.putDisk(summaries)
    }

    private static func groups(from sessions: [SessionSummaryModel]) -> [HomeSessionGroup] {
        let grouped = Dictionary(grouping: sessions) { $0.repoId }
        return grouped.values
            .compactMap { sessions in
                guard let first = sessions.first else {
                    return nil
                }
                let rows = sessions
                    .sorted { $0.createdAt > $1.createdAt }
                    .map(SessionSummary.init(summary:))
                return HomeSessionGroup(
                    repoId: first.repoId,
                    repoFullName: first.repoFullName,
                    sessions: rows
                )
            }
            .sorted { lhs, rhs in
                (lhs.sessions.first?.createdAt ?? "") > (rhs.sessions.first?.createdAt ?? "")
            }
    }
}

private extension CoreAPI.SessionSummary {
    var domainSummary: Domain.SessionSummary {
        Domain.SessionSummary(
            id: id.uuidString,
            repoId: repoId,
            repoFullName: repoFullName,
            title: title,
            archived: archived,
            workingState: workingState.rawValue,
            pushedBranch: pushedBranch,
            pullRequest: pullRequest.map {
                Domain.SessionSummary.PullRequest(
                    url: $0.url,
                    number: $0.number,
                    state: $0.state.rawValue
                )
            },
            createdAt: createdAt,
            updatedAt: updatedAt,
            lastMessageAt: lastMessageAt,
            lastAssistantMessageId: lastAssistantMessageId,
            hasUnread: hasUnread
        )
    }
}
