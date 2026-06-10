public struct User: Sendable, Equatable, Identifiable {
    public let id: String
    public let login: String
    public let name: String?
    public let avatarUrl: String?

    public init(id: String, login: String, name: String?, avatarUrl: String?) {
        self.id = id
        self.login = login
        self.name = name
        self.avatarUrl = avatarUrl
    }
}
