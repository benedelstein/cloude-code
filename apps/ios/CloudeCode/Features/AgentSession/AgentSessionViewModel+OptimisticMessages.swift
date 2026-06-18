import Domain
import Foundation

extension AgentSessionViewModel {
    func appendPendingOptimisticUserMessage(content: String) -> String {
        let clientMessageId = UUID().uuidString.lowercased()
        let message = SessionMessage(
            id: clientMessageId,
            role: .user,
            text: content,
            metadata: .object(["optimistic": .bool(true)])
        )
        pendingOptimisticUserMessage = message
        upsert(message)
        return clientMessageId
    }

    func acceptOptimisticUserMessage(clientMessageId: String, messageId: String) {
        guard let optimisticMessage = pendingOptimisticUserMessage,
              optimisticMessage.id == clientMessageId else {
            return
        }

        let acceptedMessage = SessionMessage(
            id: messageId,
            role: optimisticMessage.role,
            parts: optimisticMessage.parts,
            metadata: optimisticMessage.metadata
        )
        if !replaceMessage(id: clientMessageId, with: acceptedMessage) {
            upsert(acceptedMessage)
        }
        clearPendingOptimisticUserMessageTracking()
    }

    func upsertConfirmedUserMessage(_ message: SessionMessage) {
        guard let optimisticMessage = pendingOptimisticUserMessage,
              isServerConfirmation(message, of: optimisticMessage) else {
            upsert(message)
            return
        }

        if !replaceMessage(id: optimisticMessage.id, with: message) {
            upsert(message)
        }
        clearPendingOptimisticUserMessageTracking()
    }

    func messagesIncludingPendingOptimisticUserMessage(
        in serverMessages: [SessionMessage]
    ) -> [SessionMessage] {
        guard let optimisticMessage = pendingOptimisticUserMessage else {
            return serverMessages
        }
        if serverMessages.contains(where: { isServerConfirmation($0, of: optimisticMessage) }) {
            clearPendingOptimisticUserMessageTracking()
            return serverMessages
        }
        if serverMessages.contains(where: { $0.id == optimisticMessage.id }) {
            return serverMessages
        }
        return serverMessages + [optimisticMessage]
    }

    func clearPendingOptimisticUserMessageTracking() {
        pendingOptimisticUserMessage = nil
    }

    func removePendingOptimisticUserMessage(
        restoreDraft: Bool,
        submittedContent: String? = nil
    ) {
        guard let optimisticMessage = pendingOptimisticUserMessage else {
            return
        }
        removeMessage(id: optimisticMessage.id)
        clearPendingOptimisticUserMessageTracking()
        if restoreDraft {
            draftText = submittedContent ?? optimisticMessage.text
        }
    }

    private func isServerConfirmation(
        _ message: SessionMessage,
        of optimisticMessage: SessionMessage
    ) -> Bool {
        message.role == .user
            && message.id != optimisticMessage.id
            && message.text == optimisticMessage.text
    }
}
