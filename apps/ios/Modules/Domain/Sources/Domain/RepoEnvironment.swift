/// A user-defined environment preset for a repository, selectable when
/// creating a session. Only the fields the picker displays are cached;
/// network config, env vars, and startup scripts stay server-side.
public struct RepoEnvironment: Sendable, Equatable, Identifiable {
    public let id: String
    public let repoId: Int
    public let name: String
    public let updatedAt: String

    /// Creates a repo environment snapshot.
    public init(id: String, repoId: Int, name: String, updatedAt: String) {
        self.id = id
        self.repoId = repoId
        self.name = name
        self.updatedAt = updatedAt
    }
}
