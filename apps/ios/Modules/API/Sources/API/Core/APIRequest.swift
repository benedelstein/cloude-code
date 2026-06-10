import Foundation

public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case delete = "DELETE"
    case patch = "PATCH"
}

/// A typed API endpoint. Conforming types pair a Codable request body with a
/// Codable response so call sites get end-to-end typed `client.fetch(request)`.
public protocol APIRequest: Sendable {
    associatedtype Body: Encodable & Sendable = Never
    associatedtype Response: Decodable & Sendable

    var path: String { get }
    var method: HTTPMethod { get }
    var queryItems: [URLQueryItem] { get }
    var headers: [String: String] { get }
    var body: Body? { get }
    var responseDecoder: JSONDecoder? { get }
}

public extension APIRequest {
    var queryItems: [URLQueryItem] { [] }
    var headers: [String: String] { [:] }
    var responseDecoder: JSONDecoder? { nil }
}

public extension APIRequest where Body == Never {
    var body: Never? { nil }
}
