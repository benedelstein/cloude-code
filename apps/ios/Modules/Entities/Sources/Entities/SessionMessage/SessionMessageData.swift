import Domain
import Foundation

/// Sendable cache snapshot for one session transcript message.
public struct SessionMessageData: Sendable, Codable, Identifiable {
    /// Message identity used by `EntityStore` and SwiftData.
    public var id: String { message.id }

    public let sessionId: String
    public let createdAt: Date
    public let message: Domain.SessionMessage

    /// Creates a cache snapshot for a session message.
    public init(
        sessionId: String,
        createdAt: Date,
        message: Domain.SessionMessage
    ) {
        self.sessionId = sessionId
        self.createdAt = createdAt
        self.message = message
    }
}
