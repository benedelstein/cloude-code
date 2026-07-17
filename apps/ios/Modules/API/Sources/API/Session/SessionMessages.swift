import CoreAPI
import Domain

extension SessionMessage {
    init(_ message: CoreAPI.WireUIMessage) {
        self.init(
            id: message.id,
            role: Role(rawValue: message.role.rawValue),
            parts: message.parts.map(SessionMessage.Part.init),
            metadata: message.metadata.map(Domain.JSONValue.init)
        )
    }
}

public struct SessionSyncSnapshot: Sendable, Equatable {
    public let messages: [SessionMessage]
    public let pendingChunks: [SessionStreamChunk]
    public let pendingMessageMetadata: SessionStreamMessageMetadata?
    public let activeTurnUserMessageId: String?

    public init(
        messages: [SessionMessage],
        pendingChunks: [SessionStreamChunk],
        pendingMessageMetadata: SessionStreamMessageMetadata?,
        activeTurnUserMessageId: String?
    ) {
        self.messages = messages
        self.pendingChunks = pendingChunks
        self.pendingMessageMetadata = pendingMessageMetadata
        self.activeTurnUserMessageId = activeTurnUserMessageId
    }
}

public struct SessionStreamMessageMetadata: Sendable, Equatable {
    public let startedAt: String

    public init(startedAt: String) {
        self.startedAt = startedAt
    }
}

extension SessionStreamMessageMetadata {
    init(_ metadata: CoreAPI.MessageStreamMetadata) {
        self.init(startedAt: metadata.startedAt)
    }

    var jsonValue: Domain.JSONValue {
        .object(["startedAt": .string(startedAt)])
    }
}

extension SessionClientState {
    init(_ state: ClientState) {
        self.init(
            repoFullName: state.repoFullName,
            status: .init(rawValue: state.status.rawValue),
            sessionSetupRun: state.sessionSetupRun.map(SessionClientState.SessionSetupRun.init),
            agentSettings: SessionClientState.AgentSettings(state.agentSettings),
            pullRequest: state.pullRequest.map(SessionClientState.PullRequest.init),
            pushedBranch: state.pushedBranch,
            baseBranch: state.baseBranch,
            todos: state.todos?.map(Todo.init),
            plan: state.plan.map(Plan.init),
            pendingUserMessage: state.pendingUserMessage.map { SessionMessage($0.message) },
            activeTurnUserMessageId: state.activeTurn?.userMessageId,
            editorURL: state.editorUrl,
            providerConnection: state.providerConnection.map(ProviderConnection.init),
            agentMode: state.agentMode.rawValue,
            lastError: state.lastError,
            createdAt: state.createdAt
        )
    }
}

private extension SessionClientState.AgentSettings {
    init(_ settings: CoreAPI.AgentSettings) {
        switch settings {
        case .openaiCodex(let payload):
            self.init(
                provider: .openaiCodex,
                model: payload.model.rawValue,
                effort: payload.effort.rawValue,
                maxTokens: payload.maxTokens
            )
        case .claudeCode(let payload):
            self.init(
                provider: .claudeCode,
                model: payload.model.rawValue,
                effort: payload.effort.rawValue,
                maxTokens: payload.maxTokens
            )
        case .unknown(let type):
            self.init(provider: .unknown(type), model: "", effort: "", maxTokens: 0)
        }
    }
}

private extension SessionClientState.Plan {
    init(_ plan: CoreAPI.SessionPlanMetadata) {
        self.init(lastUpdated: plan.lastUpdated)
    }
}

private extension SessionClientState.ProviderConnection {
    init(_ connection: CoreAPI.ProviderConnectionState) {
        self.init(
            provider: connection.provider.rawValue,
            connected: connection.connected,
            requiresReauth: connection.requiresReauth
        )
    }
}

private extension SessionClientState.Todo {
    init(_ todo: CoreAPI.SessionTodo) {
        self.init(
            id: todo.id,
            content: todo.content,
            activeForm: todo.activeForm,
            status: todo.status.rawValue
        )
    }
}

private extension SessionClientState.PullRequest {
    init(_ pullRequest: CoreAPI.PullRequestClientState) {
        switch pullRequest {
        case .creating:
            self = .creating
        case .failed(let payload):
            self = .failed(error: payload.error, details: payload.details)
        case .created(let payload):
            self = .created(url: payload.url, number: payload.number, state: payload.state.rawValue)
        case .unknown(let type):
            self = .unknown(status: type)
        }
    }
}

private extension SessionClientState.SessionSetupRun {
    init(_ run: CoreAPI.SessionSetupRun) {
        self.init(
            id: run.id,
            status: .init(rawValue: run.status.rawValue),
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            tasks: run.tasks.map(SessionClientState.SessionSetupTask.init)
        )
    }
}

private extension SessionClientState.SessionSetupTask {
    init(_ task: CoreAPI.SessionSetupTask) {
        switch task {
        case .cloudContainer(let payload):
            self = Self(payload)
        case .repository(let payload):
            self = Self(payload)
        case .setupScript(let payload):
            self = Self(payload)
        case .networkPolicy(let payload):
            self = Self(payload)
        case .unknown(let type):
            self.init(
                id: type,
                status: "unknown",
                startedAt: nil,
                completedAt: nil,
                error: nil,
                isBlocking: false,
                canRetry: false,
                output: nil
            )
        }
    }

    init(_ task: CoreAPI.CloudContainerSetupTask) {
        self.init(
            id: task.id,
            status: task.status.rawValue,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            error: task.error,
            isBlocking: task.isBlocking,
            canRetry: task.canRetry,
            output: nil
        )
    }

    init(_ task: CoreAPI.RepositorySetupTask) {
        self.init(
            id: task.id,
            status: task.status.rawValue,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            error: task.error,
            isBlocking: task.isBlocking,
            canRetry: task.canRetry,
            output: nil
        )
    }

    init(_ task: CoreAPI.StartupScriptSetupTask) {
        self.init(
            id: task.id,
            status: task.status.rawValue,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            error: task.error,
            isBlocking: task.isBlocking,
            canRetry: task.canRetry,
            output: task.output.map(SessionClientState.SessionSetupTaskOutput.init)
        )
    }

    init(_ task: CoreAPI.NetworkPolicySetupTask) {
        self.init(
            id: task.id,
            status: task.status.rawValue,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            error: task.error,
            isBlocking: task.isBlocking,
            canRetry: task.canRetry,
            output: nil
        )
    }
}

private extension SessionClientState.SessionSetupTaskOutput {
    init(_ output: CoreAPI.SessionSetupTaskOutput) {
        self.init(
            exitCode: output.exitCode,
            truncated: output.truncated,
            stdoutLength: output.stdoutLength,
            stderrLength: output.stderrLength
        )
    }
}

public struct SessionSocketOperationError: Sendable, Equatable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}
