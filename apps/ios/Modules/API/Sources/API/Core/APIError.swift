import Foundation

/// Error payload returned by the api-server: `{ error, code?, details? }`.
public struct APIErrorResponse: Decodable, Sendable {
    public let error: String?
    public let code: String?
    public let details: String?
}

public enum APIError: Error, LocalizedError, Sendable {
    case invalidURL
    case invalidResponse
    case unauthenticated
    case httpError(statusCode: Int, code: String?, message: String?)
    case decodingFailed(any Error)
    case webSocketNotConnected

    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid HTTP response"
        case .unauthenticated:
            return "Unauthenticated"
        case let .httpError(statusCode, code, message):
            return message ?? code ?? "Request failed: \(statusCode)"
        case let .decodingFailed(underlying):
            return "Decoding failed: \(underlying.localizedDescription)"
        case .webSocketNotConnected:
            return "WebSocket is not connected"
        }
    }
}
