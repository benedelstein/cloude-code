import Foundation

public struct SessionSummary: Sendable, Equatable, Codable, Identifiable {
    public struct PullRequest: Sendable, Equatable, Codable {
        public let url: String
        public let number: Int
        public let state: String

        public init(url: String, number: Int, state: String) {
            self.url = url
            self.number = number
            self.state = state
        }
    }

    public let id: String
    public let repoId: Int
    public let repoFullName: String
    public let provider: AgentProviderID?
    public let title: String?
    public let archived: Bool
    /// "preparing" while setup runs, "setup_failed" after a blocking failure,
    /// and "ready" once the session accepts messages. Nil for older cached summaries.
    public let status: String?
    public let workingState: String
    public let pushedBranch: String?
    public let pullRequest: PullRequest?
    public let createdAt: String
    public let updatedAt: String
    public let lastMessageAt: String?
    public let lastAssistantMessageId: String?
    public let hasUnread: Bool

    public init(
        id: String,
        repoId: Int,
        repoFullName: String,
        provider: AgentProviderID? = nil,
        title: String? = nil,
        archived: Bool,
        status: String? = nil,
        workingState: String,
        pushedBranch: String? = nil,
        pullRequest: PullRequest? = nil,
        createdAt: String,
        updatedAt: String,
        lastMessageAt: String? = nil,
        lastAssistantMessageId: String? = nil,
        hasUnread: Bool
    ) {
        self.id = id
        self.repoId = repoId
        self.repoFullName = repoFullName
        self.provider = provider
        self.title = title
        self.archived = archived
        self.status = status
        self.workingState = workingState
        self.pushedBranch = pushedBranch
        self.pullRequest = pullRequest
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastMessageAt = lastMessageAt
        self.lastAssistantMessageId = lastAssistantMessageId
        self.hasUnread = hasUnread
    }
}
