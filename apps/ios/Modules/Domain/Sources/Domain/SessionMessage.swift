public struct SessionMessage: Sendable, Equatable, Codable, Identifiable {
    public enum Role: RawRepresentable, Sendable, Equatable, Codable {
        case user
        case assistant
        case system
        case unknown(String)

        public init(rawValue: String) {
            switch rawValue {
            case "user":
                self = .user
            case "assistant":
                self = .assistant
            case "system":
                self = .system
            default:
                self = .unknown(rawValue)
            }
        }

        public var rawValue: String {
            switch self {
            case .user:
                "user"
            case .assistant:
                "assistant"
            case .system:
                "system"
            case .unknown(let value):
                value
            }
        }
    }

    public let id: String
    public let role: Role
    public let text: String

    public var isUser: Bool {
        role == .user
    }

    public init(id: String, role: Role, text: String) {
        self.id = id
        self.role = role
        self.text = text
    }
}
