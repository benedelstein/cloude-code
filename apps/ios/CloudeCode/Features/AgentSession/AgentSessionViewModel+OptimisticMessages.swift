import Domain
import Foundation

extension SessionMessage {
    var isOptimisticUserMessage: Bool {
        guard role == .user,
              case .object(let metadata) = metadata,
              metadata["optimistic"] == .bool(true) else {
            return false
        }
        return true
    }

    var removingOptimisticMarker: SessionMessage {
        guard case .object(var metadata) = metadata,
              metadata["optimistic"] == .bool(true) else {
            return self
        }

        metadata["optimistic"] = nil
        return SessionMessage(
            id: id,
            role: role,
            parts: parts,
            metadata: metadata.isEmpty ? nil : .object(metadata)
        )
    }
}
