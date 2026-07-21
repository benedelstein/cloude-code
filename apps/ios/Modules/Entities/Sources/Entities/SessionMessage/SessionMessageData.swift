import Domain
import Foundation

/// Sendable cache snapshot for one session transcript message.
public struct SessionMessageData: Sendable, Codable, Identifiable {
    /// Message identity used by `EntityStore` and SwiftData.
    public var id: String { message.id }

    public let sessionId: String
    public let createdAt: Date
    public let message: Domain.SessionMessage
    /// Durable user-message id whose assistant response is still streaming.
    public let streamingTurnUserMessageId: String?

    /// Creates a cache snapshot for a session message.
    public init(
        sessionId: String,
        createdAt: Date,
        message: Domain.SessionMessage,
        streamingTurnUserMessageId: String? = nil
    ) {
        self.sessionId = sessionId
        self.createdAt = createdAt
        self.message = message
        self.streamingTurnUserMessageId = streamingTurnUserMessageId
    }
}
