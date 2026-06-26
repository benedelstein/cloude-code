import Foundation

/// Empty response marker for endpoints that return no body.
public struct EmptyResponse: Decodable, Sendable {
    /// Creates an empty response.
    public init() {}
}
