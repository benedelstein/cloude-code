import Domain
import Foundation
import SwiftData

/// SwiftData persistence row for one cached session transcript message.
@Model
public final class SessionMessageEntity: Entity {
    @Attribute(.unique) public private(set) var id: String
    var role: String
    var sessionId: String
    var createdAt: Date
    var messageData: Data

    /// Creates a persistence row from a session message snapshot.
    public init(_ snapshot: SessionMessageData) {
        id = snapshot.id
        role = snapshot.message.role.rawValue
        sessionId = snapshot.sessionId
        createdAt = snapshot.createdAt
        messageData = Self.encode(snapshot.message)
    }

    /// Updates this persistence row from a session message snapshot.
    public func update(_ snapshot: SessionMessageData) {
        role = snapshot.message.role.rawValue
        sessionId = snapshot.sessionId
        createdAt = snapshot.createdAt
        messageData = Self.encode(snapshot.message)
    }

    public var snapshot: SessionMessageData {
        // Generic code should call `makeSnapshot()` so decode failures can be
        // treated as cache misses. This property exists for `Entity` conformance.
        guard let snapshot = try? makeSnapshot() else {
            return SessionMessageData(
                sessionId: sessionId,
                createdAt: createdAt,
                message: Domain.SessionMessage(id: id, role: .unknown(role), parts: [])
            )
        }
        return snapshot
    }

    /// Decodes a persistence row into a cache snapshot.
    public func makeSnapshot() throws -> SessionMessageData {
        SessionMessageData(
            sessionId: sessionId,
            createdAt: createdAt,
            message: try JSONDecoder().decode(Domain.SessionMessage.self, from: messageData)
        )
    }

    public static func singleItemPredicate(_ id: String) -> Predicate<SessionMessageEntity> {
        #Predicate { $0.id == id }
    }

    public static func multiItemPredicate(_ ids: Set<String>) -> Predicate<SessionMessageEntity> {
        #Predicate { ids.contains($0.id) }
    }

    private static func encode(_ message: Domain.SessionMessage) -> Data {
        do {
            return try JSONEncoder().encode(message)
        } catch {
            preconditionFailure("failed to encode session message cache row: \(error)")
        }
    }
}
