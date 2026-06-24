import Foundation

/// Typed view over a session message's JSON metadata.
public struct SessionMessageMetadata: Sendable, Equatable {
    /// Creation timestamp from `metadata.createdAt`, when present.
    public let createdAt: Date?

    /// Provider/runtime start timestamp from `metadata.startedAt`, when present.
    public let workStartedAt: Date?

    /// Provider/runtime end timestamp from `metadata.endedAt`, when present.
    public let workEndedAt: Date?

    /// Decodes known session message metadata fields from raw JSON metadata.
    public init(_ metadata: JSONValue?) {
        createdAt = metadata.dateValue(forKey: Self.createdAtKey)
        workStartedAt = metadata.dateValue(forKey: Self.startedAtKey)
        workEndedAt = metadata.dateValue(forKey: Self.endedAtKey)
    }

    public static let createdAtKey = "createdAt"
    public static let startedAtKey = "startedAt"
    public static let endedAtKey = "endedAt"
}

public extension SessionMessage {
    /// Typed metadata decoded from the message's raw JSON metadata.
    var decodedMetadata: SessionMessageMetadata {
        SessionMessageMetadata(metadata)
    }

    /// Creation timestamp from `metadata.createdAt`, when present.
    var createdAt: Date? {
        decodedMetadata.createdAt
    }

    /// Provider/runtime start timestamp from `metadata.startedAt`, when present.
    var workStartedAt: Date? {
        decodedMetadata.workStartedAt
    }

    /// Provider/runtime end timestamp from `metadata.endedAt`, when present.
    var workEndedAt: Date? {
        decodedMetadata.workEndedAt
    }
}

private extension Optional where Wrapped == JSONValue {
    func dateValue(forKey key: String) -> Date? {
        guard case .object(let object) = self, let value = object[key] else {
            return nil
        }
        return value.dateValue
    }
}

private extension JSONValue {
    var dateValue: Date? {
        switch self {
        case .number(let milliseconds):
            Date(timeIntervalSince1970: milliseconds / 1_000)
        case .string(let string):
            Self.isoDate(from: string)
        case .bool, .object, .array, .null:
            nil
        }
    }

    private static func isoDate(from string: String) -> Date? {
        standardISOFormatter.date(from: string) ?? fractionalISOFormatter.date(from: string)
    }

    nonisolated(unsafe) private static let standardISOFormatter = ISO8601DateFormatter()

    nonisolated(unsafe) private static let fractionalISOFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
