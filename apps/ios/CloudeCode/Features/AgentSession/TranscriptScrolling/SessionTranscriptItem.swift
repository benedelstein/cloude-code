import Domain

enum SessionTranscriptItem: Identifiable, Equatable {
    case userMessage(SessionMessage)
    case assistantMessage(
        // This is the transcript row id, not necessarily displayData.message.id.
        // Streaming rows keep it stable when the final server message id arrives.
        id: String,
        AgentSessionView.MessageDisplayData,
        isStreaming: Bool
    )
    case workingIndicator(isActive: Bool)

    var id: String {
        switch self {
        case .userMessage(let message):
            Self.messageItemID(for: message.id)
        case .assistantMessage(let id, _, _):
            id
        case .workingIndicator:
            Self.workingItemID
        }
    }

    static func messageItemID(for messageID: String) -> String {
        "message:\(messageID)"
    }

    static var workingItemID: String {
        "working"
    }
}
