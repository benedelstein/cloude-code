import Domain
import Foundation
import Observation

/// Reference-identity cache wrapper for `Domain.SessionMessage`.
@MainActor
@Observable
public final class SessionMessageWrapper: EntityModel {
    public typealias Snapshot = SessionMessageData
    public typealias EntityType = SessionMessageEntity

    public let id: String
    public private(set) var sessionId: String
    public private(set) var createdAt: Date
    public private(set) var message: Domain.SessionMessage

    public var role: Domain.SessionMessage.Role {
        message.role
    }

    /// Creates a message wrapper from a cache snapshot.
    public init(_ snapshot: SessionMessageData) {
        id = snapshot.id
        sessionId = snapshot.sessionId
        createdAt = snapshot.createdAt
        message = snapshot.message
    }

    /// Merges a cache snapshot into this wrapper while preserving identity.
    public func update(from snapshot: SessionMessageData) {
        updateIfChanged(\.sessionId, to: snapshot.sessionId)
        updateIfChanged(\.createdAt, to: snapshot.createdAt)
        updateIfChanged(\.message, to: snapshot.message)
    }

    public var snapshot: SessionMessageData {
        SessionMessageData(
            sessionId: sessionId,
            createdAt: createdAt,
            message: message
        )
    }
}
