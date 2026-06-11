/// Supplies the app session token attached as `Authorization: Bearer <token>`.
/// Returning nil means signed out. The contract between authed API types and
/// whoever owns tokens (the app target's TokenCoordinator).
public protocol AuthTokenProviding: Sendable {
    func authToken() async throws -> String?
}

public extension AuthTokenProviding {
    /// `["Authorization": "Bearer <token>"]`, or throws if signed out.
    func bearerHeaders() async throws -> [String: String] {
        guard let token = try await authToken() else { throw APIError.unauthenticated }
        return ["Authorization": "Bearer \(token)"]
    }
}
