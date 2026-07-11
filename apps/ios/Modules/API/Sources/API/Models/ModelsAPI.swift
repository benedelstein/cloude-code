import CoreAPI
import Foundation

private struct GetModels: APIRequest {
    typealias Response = ModelsResponse

    var headers: [String: String]

    var path: String { "models" }
    var method: HTTPMethod { .get }
}

/// Model catalog HTTP API (`/models`).
public protocol ModelsAPIProviding: Sendable {
    func models() async throws -> ModelsResponse
}

/// Concrete model catalog API backed by `APIClient`.
public struct ModelsAPI: ModelsAPIProviding {
    private let client: APIClient
    private let tokenProvider: any AuthTokenProviding

    public init(client: APIClient, tokenProvider: any AuthTokenProviding) {
        self.client = client
        self.tokenProvider = tokenProvider
    }

    public func models() async throws -> ModelsResponse {
        // swiftlint:disable:next todo
        // TODO: caching
        try await client.fetch(GetModels(headers: tokenProvider.bearerHeaders()))
    }
}
