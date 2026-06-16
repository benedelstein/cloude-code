public struct SessionClientState: Sendable, Equatable, Codable {
    public static let empty = SessionClientState(
        repoFullName: nil,
        status: "preparing",
        sessionSetupRun: nil,
        agentSettings: AgentSettings(provider: "", model: "", effort: "", maxTokens: 0),
        pullRequest: nil,
        pushedBranch: nil,
        baseBranch: nil,
        todos: nil,
        plan: nil,
        pendingUserMessage: nil,
        activeTurnUserMessageId: nil,
        editorURL: nil,
        providerConnection: nil,
        agentMode: "edit",
        lastError: nil,
        createdAt: ""
    )

    public var repoFullName: String?
    public var status: String
    public var sessionSetupRun: SessionSetupRun?
    public var agentSettings: AgentSettings
    public var pullRequest: PullRequest?
    public var pushedBranch: String?
    public var baseBranch: String?
    public var todos: [Todo]?
    public var plan: Plan?
    public var pendingUserMessage: SessionMessage?
    public var activeTurnUserMessageId: String?
    public var editorURL: String?
    public var providerConnection: ProviderConnection?
    public var agentMode: String
    public var lastError: String?
    public var createdAt: String

    public init(
        repoFullName: String?,
        status: String,
        sessionSetupRun: SessionSetupRun?,
        agentSettings: AgentSettings,
        pullRequest: PullRequest?,
        pushedBranch: String?,
        baseBranch: String?,
        todos: [Todo]?,
        plan: Plan?,
        pendingUserMessage: SessionMessage?,
        activeTurnUserMessageId: String?,
        editorURL: String?,
        providerConnection: ProviderConnection?,
        agentMode: String,
        lastError: String?,
        createdAt: String
    ) {
        self.repoFullName = repoFullName
        self.status = status
        self.sessionSetupRun = sessionSetupRun
        self.agentSettings = agentSettings
        self.pullRequest = pullRequest
        self.pushedBranch = pushedBranch
        self.baseBranch = baseBranch
        self.todos = todos
        self.plan = plan
        self.pendingUserMessage = pendingUserMessage
        self.activeTurnUserMessageId = activeTurnUserMessageId
        self.editorURL = editorURL
        self.providerConnection = providerConnection
        self.agentMode = agentMode
        self.lastError = lastError
        self.createdAt = createdAt
    }
}

public extension SessionClientState {
    struct AgentSettings: Sendable, Equatable, Codable {
        public let provider: String
        public let model: String
        public let effort: String
        public let maxTokens: Int

        public init(provider: String, model: String, effort: String, maxTokens: Int) {
            self.provider = provider
            self.model = model
            self.effort = effort
            self.maxTokens = maxTokens
        }
    }

    struct Plan: Sendable, Equatable, Codable {
        public let lastUpdated: String

        public init(lastUpdated: String) {
            self.lastUpdated = lastUpdated
        }
    }

    struct ProviderConnection: Sendable, Equatable, Codable {
        public let provider: String
        public let connected: Bool
        public let requiresReauth: Bool

        public init(provider: String, connected: Bool, requiresReauth: Bool) {
            self.provider = provider
            self.connected = connected
            self.requiresReauth = requiresReauth
        }
    }

    struct Todo: Sendable, Equatable, Codable, Identifiable {
        public let id: String?
        public let content: String
        public let activeForm: String?
        public let status: String

        public init(id: String?, content: String, activeForm: String?, status: String) {
            self.id = id
            self.content = content
            self.activeForm = activeForm
            self.status = status
        }
    }

    enum PullRequest: Sendable, Equatable, Codable {
        case creating
        case failed(error: String, details: String?)
        case created(url: String, number: Int, state: String)
        case unknown(status: String)
    }

    struct SessionSetupRun: Sendable, Equatable, Codable {
        public let id: String
        public let status: String
        public let startedAt: String
        public let completedAt: String?
        public let tasks: [SessionSetupTask]

        public init(
            id: String,
            status: String,
            startedAt: String,
            completedAt: String?,
            tasks: [SessionSetupTask]
        ) {
            self.id = id
            self.status = status
            self.startedAt = startedAt
            self.completedAt = completedAt
            self.tasks = tasks
        }
    }

    struct SessionSetupTask: Sendable, Equatable, Codable, Identifiable {
        public let id: String
        public let status: String
        public let startedAt: String?
        public let completedAt: String?
        public let error: String?
        public let isBlocking: Bool
        public let canRetry: Bool
        public let output: SessionSetupTaskOutput?

        public init(
            id: String,
            status: String,
            startedAt: String?,
            completedAt: String?,
            error: String?,
            isBlocking: Bool,
            canRetry: Bool,
            output: SessionSetupTaskOutput?
        ) {
            self.id = id
            self.status = status
            self.startedAt = startedAt
            self.completedAt = completedAt
            self.error = error
            self.isBlocking = isBlocking
            self.canRetry = canRetry
            self.output = output
        }
    }

    struct SessionSetupTaskOutput: Sendable, Equatable, Codable {
        public let exitCode: Int?
        public let truncated: Bool
        public let stdoutLength: Int?
        public let stderrLength: Int?

        public init(exitCode: Int?, truncated: Bool, stdoutLength: Int?, stderrLength: Int?) {
            self.exitCode = exitCode
            self.truncated = truncated
            self.stdoutLength = stdoutLength
            self.stderrLength = stderrLength
        }
    }
}
