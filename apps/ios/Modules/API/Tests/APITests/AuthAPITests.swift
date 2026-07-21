@testable import API
import Foundation
import Testing

@Suite("Auth API", .serialized)
struct AuthAPITests {
    @Test func installationStartUsesAuthenticatedPostAndMapsPage() async throws {
        let recorder = AuthRequestRecorder()
        let api = makeAPI(recorder: recorder)

        let page = try await api.githubInstallationPage(
            redirectUri: "cloudecode-dev://auth/callback"
        )

        let request = try #require(await recorder.request)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/auth/github/install/start")
        #expect(request.url?.query == "redirectUri=cloudecode-dev://auth/callback")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-token")
        #expect(page.state == "install-state")
        #expect(page.url.absoluteString == "https://github.test/install?state=install-state")
    }

    private func makeAPI(recorder: AuthRequestRecorder) -> AuthAPI {
        guard let baseURL = URL(string: "https://api.example.com") else {
            preconditionFailure("invalid test base URL")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AuthURLProtocol.self]
        AuthURLProtocol.handler = { request in
            await recorder.record(request)
            guard let url = request.url,
                  let response = HTTPURLResponse(
                      url: url,
                      statusCode: 200,
                      httpVersion: nil,
                      headerFields: ["Content-Type": "application/json"]
                  ) else {
                preconditionFailure("failed to create test response")
            }
            let json = #"{"url":"https://github.test/install?state=install-state","state":"install-state"}"#
            return (response, Data(json.utf8))
        }
        return AuthAPI(
            client: APIClient(
                baseURL: baseURL,
                urlSession: URLSession(configuration: configuration)
            ),
            tokenProvider: AuthTestTokenProvider()
        )
    }
}

private actor AuthRequestRecorder {
    private(set) var request: URLRequest?

    func record(_ request: URLRequest) {
        self.request = request
    }
}

private struct AuthTestTokenProvider: AuthTokenProviding {
    func authToken() async throws -> String? {
        "test-token"
    }
}

private final class AuthURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) async -> (HTTPURLResponse, Data))?

    override static func canInit(with request: URLRequest) -> Bool { true }
    override static func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Task { [request] in
            guard let handler = Self.handler else { return }
            let (response, data) = await handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
