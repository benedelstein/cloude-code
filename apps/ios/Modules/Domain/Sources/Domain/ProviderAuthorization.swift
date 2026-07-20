/// Authorization URL and state returned when a provider sign-in flow begins.
public struct ProviderAuthorization: Sendable, Equatable {
    public let url: String
    public let state: String

    /// Creates a provider authorization request.
    public init(url: String, state: String) {
        self.url = url
        self.state = state
    }
}

/// OpenAI Codex device authorization details shown while the user signs in.
public struct OpenAIDeviceAuthorization: Sendable, Equatable {
    public let attemptId: String
    public let verificationURL: String
    public let userCode: String
    public let intervalSeconds: Int

    /// Creates an OpenAI Codex device authorization attempt.
    public init(
        attemptId: String,
        verificationURL: String,
        userCode: String,
        intervalSeconds: Int
    ) {
        self.attemptId = attemptId
        self.verificationURL = verificationURL
        self.userCode = userCode
        self.intervalSeconds = intervalSeconds
    }
}

/// Current state of an OpenAI Codex device authorization attempt.
public enum OpenAIDeviceAuthorizationStatus: Sendable, Equatable {
    case pending
    case completed
    case expired
    case unknown(String)
}
