public enum AgentProviderID: RawRepresentable, Sendable, Equatable, Codable {
    case claudeCode
    case openaiCodex
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "claude-code":
            self = .claudeCode
        case "openai-codex":
            self = .openaiCodex
        default:
            self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .claudeCode:
            "claude-code"
        case .openaiCodex:
            "openai-codex"
        case .unknown(let value):
            value
        }
    }
}
