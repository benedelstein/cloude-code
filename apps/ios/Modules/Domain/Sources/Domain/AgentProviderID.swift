public enum AgentProviderID: Sendable, Equatable, Codable {
    case claudeCode
    case openaiCodex
    case unknown(String)
}
