import Domain

enum SessionTranscriptItem: Identifiable, Equatable {
    case userMessage(SessionMessage)
    case assistantMessage(
        AgentSessionView.MessageDisplayData,
        isStreaming: Bool,
        autoCollapse: Bool
    )
    case workingIndicator

    var id: String {
        switch self {
        case .userMessage(let message):
            Self.messageItemID(for: message.id)
        case .assistantMessage(let displayData, let isStreaming, _):
            if isStreaming {
                Self.streamingItemID(for: displayData.id)
            } else {
                Self.messageItemID(for: displayData.id)
            }
        case .workingIndicator:
            Self.workingItemID
        }
    }

    static func messageItemID(for messageID: String) -> String {
        "message:\(messageID)"
    }

    static func streamingItemID(for messageID: String) -> String {
        "streaming:\(messageID)"
    }

    static var workingItemID: String {
        "working"
    }
}
