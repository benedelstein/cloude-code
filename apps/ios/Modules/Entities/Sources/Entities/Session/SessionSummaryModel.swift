import Domain
import Observation

@MainActor
@Observable
public final class SessionSummaryModel: EntityModel {
    public typealias EntityType = SessionSummaryEntity

    public let id: String
    public var repoId: Int
    public var repoFullName: String
    public var provider: AgentProviderID?
    public var title: String?
    public var archived: Bool
    public var status: String?
    public var workingState: String
    public var pushedBranch: String?
    public var pullRequest: Domain.SessionSummary.PullRequest?
    public var createdAt: String
    public var updatedAt: String
    public var lastMessageAt: String?
    public var lastAssistantMessageId: String?
    public var hasUnread: Bool

    public init(_ snapshot: Domain.SessionSummary) {
        id = snapshot.id
        repoId = snapshot.repoId
        repoFullName = snapshot.repoFullName
        provider = snapshot.provider
        title = snapshot.title
        archived = snapshot.archived
        status = snapshot.status
        workingState = snapshot.workingState
        pushedBranch = snapshot.pushedBranch
        pullRequest = snapshot.pullRequest
        createdAt = snapshot.createdAt
        updatedAt = snapshot.updatedAt
        lastMessageAt = snapshot.lastMessageAt
        lastAssistantMessageId = snapshot.lastAssistantMessageId
        hasUnread = snapshot.hasUnread
    }

    public func update(from snapshot: Domain.SessionSummary) {
        updateIfChanged(\.repoId, to: snapshot.repoId)
        updateIfChanged(\.repoFullName, to: snapshot.repoFullName)
        updateIfChanged(\.provider, to: snapshot.provider)
        updateIfChanged(\.title, to: snapshot.title)
        updateIfChanged(\.archived, to: snapshot.archived)
        updateIfChanged(\.status, to: snapshot.status)
        updateIfChanged(\.workingState, to: snapshot.workingState)
        updateIfChanged(\.pushedBranch, to: snapshot.pushedBranch)
        updateIfChanged(\.pullRequest, to: snapshot.pullRequest)
        updateIfChanged(\.createdAt, to: snapshot.createdAt)
        updateIfChanged(\.updatedAt, to: snapshot.updatedAt)
        updateIfChanged(\.lastMessageAt, to: snapshot.lastMessageAt)
        updateIfChanged(\.lastAssistantMessageId, to: snapshot.lastAssistantMessageId)
        updateIfChanged(\.hasUnread, to: snapshot.hasUnread)
    }

    public var snapshot: Domain.SessionSummary {
        Domain.SessionSummary(
            id: id,
            repoId: repoId,
            repoFullName: repoFullName,
            provider: provider,
            title: title,
            archived: archived,
            status: status,
            workingState: workingState,
            pushedBranch: pushedBranch,
            pullRequest: pullRequest,
            createdAt: createdAt,
            updatedAt: updatedAt,
            lastMessageAt: lastMessageAt,
            lastAssistantMessageId: lastAssistantMessageId,
            hasUnread: hasUnread
        )
    }
}

// Identity-based equality: the store guarantees one canonical instance per id,
// so reference identity is the right notion for navigation values and diffing.
extension SessionSummaryModel: Hashable {
    public nonisolated static func == (lhs: SessionSummaryModel, rhs: SessionSummaryModel) -> Bool {
        lhs === rhs
    }

    public nonisolated func hash(into hasher: inout Hasher) {
        hasher.combine(ObjectIdentifier(self))
    }
}

public typealias SessionSummaryStore = EntityStore<SessionSummaryModel>
