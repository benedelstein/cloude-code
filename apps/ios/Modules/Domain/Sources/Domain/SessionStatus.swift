/// The lifecycle state exposed for a session summary.
public enum SessionStatus: Sendable, Equatable, Codable {
    case preparing
    case setupFailed
    case ready
    case unknown(String)

    /// Creates a session status while preserving values unknown to this client version.
    public init(rawValue: String) {
        switch rawValue {
        case "preparing":
            self = .preparing
        case "setup_failed":
            self = .setupFailed
        case "ready":
            self = .ready
        default:
            self = .unknown(rawValue)
        }
    }

    /// The session status used by API and persistence boundaries.
    public var rawValue: String {
        switch self {
        case .preparing:
            "preparing"
        case .setupFailed:
            "setup_failed"
        case .ready:
            "ready"
        case .unknown(let value):
            value
        }
    }
}
