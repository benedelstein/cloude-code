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
            "message:\(message.id)"
        case .assistantMessage(let displayData, let isStreaming, _):
            if isStreaming {
                "streaming:\(displayData.id)"
            } else {
                "message:\(displayData.id)"
            }
        case .workingIndicator:
            "working"
        }
    }
}
