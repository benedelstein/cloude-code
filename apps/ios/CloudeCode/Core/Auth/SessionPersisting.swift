import Domain

/// Durable storage for the auth session (keychain in production).
protocol SessionPersisting: Sendable {
    func load() throws -> Session?
    func save(_ session: Session) throws
    func clear() throws
}
