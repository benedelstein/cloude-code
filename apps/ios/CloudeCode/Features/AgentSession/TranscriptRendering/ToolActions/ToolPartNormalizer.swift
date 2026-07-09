import Domain

protocol ToolPartNormalizer: Sendable {
    func normalize(_ part: NormalizableToolPart) -> [NormalizedToolAction]
}

enum ToolActionNormalizer {
    /// Normalizes a message part into an array of provider-agnosti (normalized)  tool actions
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
        case .unknown(let providerId) where providerId.isEmpty:
            normalizeBeforeProviderHydration(toolPart)
        case nil:
            [.other(from: toolPart)]
        case .unknown:
            [.other(from: toolPart)]
        }
    }

    private static func normalizeBeforeProviderHydration(
        _ toolPart: NormalizableToolPart
    ) -> [NormalizedToolAction] {
        // Cached messages render before live state supplies the session provider.
        // Known providers have distinct tool signatures, so preserve their
        // specific rows instead of briefly collapsing everything into `.other`.
        switch inferredProvider(for: toolPart) {
        case .claudeCode:
            ClaudeCodeToolPartNormalizer().normalize(toolPart)
        case .openaiCodex:
            OpenAICodexToolPartNormalizer().normalize(toolPart)
        case .unknown, nil:
            [.other(from: toolPart)]
        }
    }

    private static func inferredProvider(
        for toolPart: NormalizableToolPart
    ) -> AgentProviderID? {
        let inputType = toolPart.input?.objectValue?.string("type")
        if let inputType, ["commandExecution", "fileChange", "webSearch"].contains(inputType) {
            return .openaiCodex
        }

        switch toolPart.toolName {
        case "exec", "patch", "web_search", "update_plan":
            return .openaiCodex
        case "Read", "Edit", "MultiEdit", "Write", "Bash", "Grep", "Glob",
             "WebFetch", "WebSearch", "TodoWrite", "TaskCreate", "TaskUpdate",
             "TaskList", "TaskGet", "ExitPlanMode":
            return .claudeCode
        default:
            return nil
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
