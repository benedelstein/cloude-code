import CoreAPI
import Domain
import Foundation

extension Session {
    /// Builds local session metadata from a server-verified native access JWT.
    /// The app decodes `sub` and `exp` only for cache lookup and refresh timing;
    /// the API remains the authority that verifies the token signature.
    init(
        nativeAccessToken accessToken: String,
        refreshToken: String,
        refreshTokenExpiresAt refreshExpiryString: CoreAPI.ISODateTimeString
    ) throws {
        let claims = try NativeAccessTokenClaims(accessToken: accessToken)
        guard let refreshExpiry = ISO8601.date(from: refreshExpiryString) else {
            throw APIError.decodingFailed(NativeAccessTokenSessionError.invalidRefreshExpiry)
        }

        self.init(
            accessToken: accessToken,
            accessTokenExpiresAt: claims.expiresAt,
            refreshToken: refreshToken,
            refreshTokenExpiresAt: refreshExpiry,
            userId: claims.userId
        )
    }
}

private struct NativeAccessTokenClaims: Decodable {
    let sub: String
    let exp: TimeInterval

    var userId: String { sub }
    var expiresAt: Date { Date(timeIntervalSince1970: exp) }

    init(accessToken: String) throws {
        let parts = accessToken.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else {
            throw APIError.decodingFailed(NativeAccessTokenSessionError.invalidJWT)
        }

        guard let payload = Data(base64URLEncoded: String(parts[1])) else {
            throw APIError.decodingFailed(NativeAccessTokenSessionError.invalidJWT)
        }

        self = try JSONDecoder().decode(Self.self, from: payload)
    }
}

private extension Data {
    init?(base64URLEncoded value: String) {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }
        self.init(base64Encoded: base64)
    }
}

private enum NativeAccessTokenSessionError: Error, CustomStringConvertible {
    case invalidJWT
    case invalidRefreshExpiry

    var description: String {
        switch self {
        case .invalidJWT:
            return "Unparseable native access token"
        case .invalidRefreshExpiry:
            return "Unparseable refresh token expiry"
        }
    }
}
