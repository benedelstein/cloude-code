import Domain

enum SessionTranscriptSetupRun: Equatable {
    case placeholder
    case run(
        SessionClientState.SessionSetupRun,
        isExpanded: Bool
    )
}

enum SessionTranscriptItem: Identifiable, Equatable {
    // Both message cases carry the transcript row id, not necessarily the
    // SessionMessage id. Streaming assistant rows keep it stable when the final
    // server message id arrives, and optimistic user rows keep it stable when
    // the server-accepted id replaces the client-generated one.
    case userMessage(
        id: String,
        SessionMessage
    )
    case assistantMessage(
        id: String,
        AgentSessionView.MessageDisplayData,
        isStreaming: Bool
    )
    case setupRun(SessionTranscriptSetupRun)
    case workingIndicator(isActive: Bool)

    var id: String {
        switch self {
        case .userMessage(let id, _):
            id
        case .assistantMessage(let id, _, _):
            id
        case .setupRun:
            Self.setupRunItemID
        case .workingIndicator:
            Self.workingItemID
        }
    }

    static func messageItemID(for messageID: String) -> String {
        "message:\(messageID)"
    }

    static var setupRunItemID: String {
        "setup-run"
    }

    static var workingItemID: String {
        "working"
    }
}
