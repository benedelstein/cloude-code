public enum AgentProviderID: Sendable, Equatable, Codable {
    case claudeCode
    case openaiCodex
    case unknown(String)

    /// Creates a provider identifier while preserving values unknown to this client version.
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

    /// The provider identifier used by API and persistence boundaries.
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
