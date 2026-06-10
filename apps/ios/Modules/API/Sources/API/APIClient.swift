import Foundation

public protocol GreetingAPIProviding: Sendable {
    func fetchGreeting() async throws -> String
}

public struct APIClient: GreetingAPIProviding {
    private let baseURL: URL?
    private let urlSession: URLSession

    public init(baseURL: URL? = nil, urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.urlSession = urlSession
    }

    public func fetchGreeting() async throws -> String {
        guard let baseURL else {
            return "Needle + SwiftUI CloudeCode is ready."
        }

        let endpoint = baseURL.appending(path: "greeting")
        let (data, _) = try await urlSession.data(from: endpoint)
        return String(bytes: data, encoding: .utf8) ?? ""
    }
}
