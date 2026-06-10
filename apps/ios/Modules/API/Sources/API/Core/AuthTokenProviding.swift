/// Supplies the app session token attached as `Authorization: Bearer <token>`.
/// Returning nil sends the request unauthenticated.
public protocol AuthTokenProviding: Sendable {
    func authToken() async throws -> String?
}
