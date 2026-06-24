public extension JSONValue {
    /// Returns the string payload for string JSON values.
    var stringValue: String? {
        guard case .string(let value) = self else {
            return nil
        }
        return value
    }

    /// Returns the number payload for numeric JSON values.
    var numberValue: Double? {
        guard case .number(let value) = self else {
            return nil
        }
        return value
    }
}
