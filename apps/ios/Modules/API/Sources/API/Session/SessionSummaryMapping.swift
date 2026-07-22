import CoreAPI
import Domain
import Foundation

/// One page of the session list, already mapped to domain values. Groups are
/// derivable client-side from `SessionSummary.repoId`/`repoFullName`.
public struct SessionSummaryPage: Sendable, Equatable {
    public let summaries: [Domain.SessionSummary]
    public let nextRepoCursor: String?

    public init(summaries: [Domain.SessionSummary], nextRepoCursor: String?) {
        self.summaries = summaries
        self.nextRepoCursor = nextRepoCursor
    }
}

extension CoreAPI.SessionSummary {
    var domainSummary: Domain.SessionSummary {
        Domain.SessionSummary(
            id: id,
            repoId: repoId,
            repoFullName: repoFullName,
            provider: provider.map { AgentProviderID(rawValue: $0.rawValue) },
            title: title,
            archived: archived,
            status: status.map { Domain.SessionStatus(rawValue: $0.rawValue) },
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

extension ListSessionsResponse {
    var summaryPage: SessionSummaryPage {
        SessionSummaryPage(
            summaries: groups.flatMap(\.sessions).map(\.domainSummary),
            nextRepoCursor: nextRepoCursor
        )
    }
}
