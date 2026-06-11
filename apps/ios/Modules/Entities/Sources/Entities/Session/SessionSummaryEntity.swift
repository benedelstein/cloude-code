import Domain
import Foundation
import SwiftData

@Model
public final class SessionSummaryEntity: Entity {
    @Attribute(.unique) public private(set) var id: String
    var repoId: Int
    var repoFullName: String
    var title: String?
    var archived: Bool
    var workingState: String
    var pushedBranch: String?
    var pullRequestUrl: String?
    var pullRequestNumber: Int?
    var pullRequestState: String?
    var createdAt: String
    var updatedAt: String
    var lastMessageAt: String?
    var lastAssistantMessageId: String?
    var hasUnread: Bool

    public init(_ snapshot: Domain.SessionSummary) {
        id = snapshot.id
        repoId = snapshot.repoId
        repoFullName = snapshot.repoFullName
        title = snapshot.title
        archived = snapshot.archived
        workingState = snapshot.workingState
        pushedBranch = snapshot.pushedBranch
        pullRequestUrl = snapshot.pullRequest?.url
        pullRequestNumber = snapshot.pullRequest?.number
        pullRequestState = snapshot.pullRequest?.state
        createdAt = snapshot.createdAt
        updatedAt = snapshot.updatedAt
        lastMessageAt = snapshot.lastMessageAt
        lastAssistantMessageId = snapshot.lastAssistantMessageId
        hasUnread = snapshot.hasUnread
    }

    public func update(_ snapshot: Domain.SessionSummary) {
        repoId = snapshot.repoId
        repoFullName = snapshot.repoFullName
        title = snapshot.title
        archived = snapshot.archived
        workingState = snapshot.workingState
        pushedBranch = snapshot.pushedBranch
        pullRequestUrl = snapshot.pullRequest?.url
        pullRequestNumber = snapshot.pullRequest?.number
        pullRequestState = snapshot.pullRequest?.state
        createdAt = snapshot.createdAt
        updatedAt = snapshot.updatedAt
        lastMessageAt = snapshot.lastMessageAt
        lastAssistantMessageId = snapshot.lastAssistantMessageId
        hasUnread = snapshot.hasUnread
    }

    public var snapshot: Domain.SessionSummary {
        Domain.SessionSummary(
            id: id,
            repoId: repoId,
            repoFullName: repoFullName,
            title: title,
            archived: archived,
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

    public static func singleItemPredicate(_ id: String) -> Predicate<SessionSummaryEntity> {
        #Predicate { $0.id == id }
    }

    public static func multiItemPredicate(_ ids: Set<String>) -> Predicate<SessionSummaryEntity> {
        #Predicate { ids.contains($0.id) }
    }

    private var pullRequest: Domain.SessionSummary.PullRequest? {
        guard let pullRequestUrl, let pullRequestNumber, let pullRequestState else {
            return nil
        }
        return Domain.SessionSummary.PullRequest(
            url: pullRequestUrl,
            number: pullRequestNumber,
            state: pullRequestState
        )
    }
}
