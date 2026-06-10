public protocol GreetingAPIProviding: Sendable {
    func fetchGreeting() async throws -> String
}

/// Scaffold placeholder until real endpoints exist.
public struct GreetingAPI: GreetingAPIProviding {
    public init() {}

    public func fetchGreeting() async throws -> String {
        "Needle + SwiftUI CloudeCode is ready."
    }
}
