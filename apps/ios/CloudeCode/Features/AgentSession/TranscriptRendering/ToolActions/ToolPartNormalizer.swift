import Domain

protocol ToolPartNormalizer: Sendable {
    func normalize(_ part: NormalizableToolPart) -> [NormalizedToolAction]
}

enum ToolActionNormalizer {
    static func normalize(
        part: SessionMessage.Part,
        providerId: AgentProviderID?
    ) -> [NormalizedToolAction] {
        guard let toolPart = NormalizableToolPart(part) else {
            return []
        }

        return normalize(toolPart: toolPart, providerId: providerId)
    }

    static func normalize(
        toolPart: NormalizableToolPart,
        providerId: AgentProviderID?
    ) -> [NormalizedToolAction] {
        switch providerId {
        case .claudeCode:
            ClaudeCodeToolPartNormalizer().normalize(toolPart)
        case .openaiCodex:
            OpenAICodexToolPartNormalizer().normalize(toolPart)
        case .unknown, nil:
            [.other(from: toolPart)]
        }
    }
}

extension JSONValue {
    var objectValue: [String: JSONValue]? {
        guard case .object(let value) = self else {
            return nil
        }
        return value
    }

    var arrayValue: [JSONValue]? {
        guard case .array(let value) = self else {
            return nil
        }
        return value
    }

    var stringValue: String? {
        switch self {
        case .string(let value):
            value
        case .number(let value) where value.rounded() == value:
            String(Int(value))
        case .number(let value):
            String(value)
        case .bool, .object, .array, .null:
            nil
        }
    }

    var intValue: Int? {
        guard case .number(let value) = self, value.rounded() == value else {
            return nil
        }
        return Int(value)
    }
}

extension Dictionary where Key == String, Value == JSONValue {
    func string(_ key: String) -> String {
        self[key]?.stringValue ?? ""
    }

    func object(_ key: String) -> [String: JSONValue]? {
        self[key]?.objectValue
    }

    func array(_ key: String) -> [JSONValue]? {
        self[key]?.arrayValue
    }
}

func lineDiff(oldString: String, newString: String) -> String {
    var lines: [String] = []
    if !oldString.isEmpty {
        lines.append(contentsOf: oldString
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { "-\($0)" })
    }
    if !newString.isEmpty {
        lines.append(contentsOf: newString
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { "+\($0)" })
    }
    return lines.joined(separator: "\n")
}
