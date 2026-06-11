import Foundation

/// An authenticated session: one logical credential pairing a short-lived
/// access token with the rotating refresh token that renews it. Issued,
/// rotated, and revoked together, so they persist as one atomic value.
///
/// The access token is opaque — staleness comes only from
/// `accessTokenExpiresAt`, never from decoding token contents.
public struct Session: Sendable, Equatable, Codable {
    public let accessToken: String
    public let accessTokenExpiresAt: Date
    public let refreshToken: String
    public let refreshTokenExpiresAt: Date
    /// Lets startup load the signed-in user from the local cache.
    public let userId: String

    public init(
        accessToken: String,
        accessTokenExpiresAt: Date,
        refreshToken: String,
        refreshTokenExpiresAt: Date,
        userId: String
    ) {
        self.accessToken = accessToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.refreshToken = refreshToken
        self.refreshTokenExpiresAt = refreshTokenExpiresAt
        self.userId = userId
    }

    public func isAccessTokenStale(margin: TimeInterval = 60, now: Date = Date()) -> Bool {
        now.addingTimeInterval(margin) >= accessTokenExpiresAt
    }
}
