/// A complete user-defined environment preset for a repository.
public struct RepoEnvironment: Codable, Sendable, Equatable, Identifiable {
    /// The environment's outbound network configuration.
    public enum Network: Codable, Sendable, Equatable {
        /// Blocks outbound network access except required proxied services.
        case locked
        /// Uses the server-managed default allowlist.
        case `default`
        /// Uses a custom allowlist, optionally including server defaults.
        case custom(extraAllowlist: [String], includeDefaultAllowlist: Bool)
        /// Allows unrestricted outbound network access.
        case open
        /// A server mode this client version does not recognize yet.
        case unknown(String)
    }

    /// User-editable values accepted by environment mutation endpoints.
    public struct Input: Sendable, Equatable {
        public let name: String
        public let network: Network
        public let plainEnvVars: [String: String]
        public let startupScript: String?

        /// Creates environment mutation input.
        public init(
            name: String,
            network: Network,
            plainEnvVars: [String: String],
            startupScript: String?
        ) {
            self.name = name
            self.network = network
            self.plainEnvVars = plainEnvVars
            self.startupScript = startupScript
        }
    }

    public let id: String
    public let repoId: Int
    public let name: String
    public let network: Network
    public let plainEnvVars: [String: String]
    public let startupScript: String?
    public let createdAt: String
    public let updatedAt: String

    /// Creates a repo environment snapshot.
    public init(
        id: String,
        repoId: Int,
        name: String,
        network: Network,
        plainEnvVars: [String: String],
        startupScript: String?,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.repoId = repoId
        self.name = name
        self.network = network
        self.plainEnvVars = plainEnvVars
        self.startupScript = startupScript
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
