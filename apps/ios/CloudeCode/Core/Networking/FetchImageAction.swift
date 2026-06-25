import Foundation
import SwiftUI

protocol FetchImageAction: Sendable {
    func callAsFunction(_ url: URL) async throws -> Data
}

struct UnauthenticatedFetchImageAction: FetchImageAction {
    func callAsFunction(_ url: URL) async throws -> Data {
        if url.scheme == "data" {
            return try dataURLPayload(url)
        }
        if url.isFileURL {
            return try Data(contentsOf: url)
        }

        let (data, response) = try await URLSession.shared.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return data
    }
}

struct AuthenticatedFetchImageAction: FetchImageAction {
    private let apiBaseURL: URL
    private let headersProvider: @Sendable () async throws -> [String: String]

    init(
        apiBaseURL: URL,
        headersProvider: @escaping @Sendable () async throws -> [String: String]
    ) {
        self.apiBaseURL = apiBaseURL
        self.headersProvider = headersProvider
    }

    func callAsFunction(_ url: URL) async throws -> Data {
        if url.scheme == "data" {
            return try dataURLPayload(url)
        }
        if url.isFileURL {
            return try Data(contentsOf: url)
        }

        var request = URLRequest(url: url)
        if url.hasSameOrigin(as: apiBaseURL) {
            let headers = try await headersProvider()
            for (key, value) in headers {
                request.setValue(value, forHTTPHeaderField: key)
            }
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return data
    }
}

private func dataURLPayload(_ url: URL) throws -> Data {
    let rawValue = url.absoluteString
    guard let commaIndex = rawValue.firstIndex(of: ",") else {
        throw URLError(.badURL)
    }

    let metadata = rawValue[..<commaIndex]
    let payload = rawValue[rawValue.index(after: commaIndex)...]
    if metadata.contains(";base64") {
        guard let data = Data(base64Encoded: String(payload)) else {
            throw URLError(.cannotDecodeContentData)
        }
        return data
    }

    guard let decoded = String(payload).removingPercentEncoding,
          let data = decoded.data(using: .utf8) else {
        throw URLError(.cannotDecodeContentData)
    }
    return data
}

extension EnvironmentValues {
    @Entry
    var fetchImageAction: any FetchImageAction = UnauthenticatedFetchImageAction()
}

private extension URL {
    func hasSameOrigin(as other: URL) -> Bool {
        scheme == other.scheme && host == other.host && normalizedPort == other.normalizedPort
    }

    var normalizedPort: Int? {
        if let port {
            return port
        }

        switch scheme {
        case "http":
            return 80
        case "https":
            return 443
        default:
            return nil
        }
    }
}
