public extension SessionMessage {
    /// ISO timestamp from `metadata.createdAt`, when present.
    var createdAtMetadata: String? {
        metadata?["createdAt"]?.stringValue
    }

    /// Numeric provider/runtime start timestamp from `metadata.startedAt`, when present.
    var startedAtMetadata: Double? {
        metadata?["startedAt"]?.numberValue
    }

    /// Numeric provider/runtime end timestamp from `metadata.endedAt`, when present.
    var endedAtMetadata: Double? {
        metadata?["endedAt"]?.numberValue
    }
}

private extension JSONValue {
    subscript(key: String) -> JSONValue? {
        guard case .object(let object) = self else {
            return nil
        }
        return object[key]
    }
}
