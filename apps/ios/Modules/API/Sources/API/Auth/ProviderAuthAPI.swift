import CoreAPI
import Domain
import Foundation

private struct GetClaudeAuthorization: APIRequest {
    typealias Response = ClaudeAuthUrlResponse

    var headers: [String: String]

    var path: String { "auth/claude" }
    var method: HTTPMethod { .get }
}

private struct ExchangeClaudeCode: APIRequest {
    typealias Body = ClaudeTokenRequest
    typealias Response = ClaudeTokenResponse

    var body: ClaudeTokenRequest?
    var headers: [String: String]

    var path: String { "auth/claude/token" }
    var method: HTTPMethod { .post }
}

private struct StartOpenAIDeviceAuthorization: APIRequest {
    typealias Response = OpenAIDeviceStartResponse

    var headers: [String: String]

    var path: String { "auth/openai/device/start" }
    var method: HTTPMethod { .post }
}

private struct PollOpenAIDeviceAuthorization: APIRequest {
    typealias Response = OpenAIDeviceAttemptResponse

    var attemptId: String
    var sessionId: String?
    var headers: [String: String]

    var path: String { "auth/openai/device/attempts/\(attemptId)" }
    var method: HTTPMethod { .get }
    var queryItems: [URLQueryItem] {
        sessionId.map { [URLQueryItem(name: "sessionId", value: $0)] } ?? []
    }
}

/// Provider-account authorization API used by native connection flows.
public protocol ProviderAuthAPIProviding: Sendable {
    /// Starts Claude authorization and returns the external URL and exchange state.
    func claudeAuthorization() async throws -> ProviderAuthorization

    /// Exchanges the code copied from Claude and refreshes an active session when supplied.
    func exchangeClaudeCode(code: String, state: String, sessionId: String?) async throws

    /// Starts OpenAI Codex device authorization.
    func startOpenAIDeviceAuthorization() async throws -> OpenAIDeviceAuthorization

    /// Polls an OpenAI Codex device authorization attempt.
    func pollOpenAIDeviceAuthorization(
        attemptId: String,
        sessionId: String?
    ) async throws -> OpenAIDeviceAuthorizationStatus
}

/// Concrete provider-account authorization API backed by `APIClient`.
public struct ProviderAuthAPI: ProviderAuthAPIProviding {
    private let client: APIClient
    private let tokenProvider: any AuthTokenProviding

    /// Creates a provider authorization API.
    public init(client: APIClient, tokenProvider: any AuthTokenProviding) {
        self.client = client
        self.tokenProvider = tokenProvider
    }

    /// Starts Claude authorization and returns the external URL and exchange state.
    public func claudeAuthorization() async throws -> ProviderAuthorization {
        let response = try await client.fetch(GetClaudeAuthorization(
            headers: tokenProvider.bearerHeaders()
        ))
        return ProviderAuthorization(url: response.url, state: response.state)
    }

    /// Exchanges the code copied from Claude and refreshes an active session when supplied.
    public func exchangeClaudeCode(code: String, state: String, sessionId: String?) async throws {
        _ = try await client.fetch(ExchangeClaudeCode(
            body: ClaudeTokenRequest(code: code, state: state, sessionId: sessionId),
            headers: tokenProvider.bearerHeaders()
        ))
    }

    /// Starts OpenAI Codex device authorization.
    public func startOpenAIDeviceAuthorization() async throws -> OpenAIDeviceAuthorization {
        let response = try await client.fetch(StartOpenAIDeviceAuthorization(
            headers: tokenProvider.bearerHeaders()
        ))
        return OpenAIDeviceAuthorization(
            attemptId: response.attemptId,
            verificationURL: response.verificationUrl,
            userCode: response.userCode,
            intervalSeconds: response.intervalSeconds
        )
    }

    /// Polls an OpenAI Codex device authorization attempt.
    public func pollOpenAIDeviceAuthorization(
        attemptId: String,
        sessionId: String?
    ) async throws -> OpenAIDeviceAuthorizationStatus {
        let response = try await client.fetch(PollOpenAIDeviceAuthorization(
            attemptId: attemptId,
            sessionId: sessionId,
            headers: tokenProvider.bearerHeaders()
        ))
        return switch response.status {
        case .pending: .pending
        case .completed: .completed
        case .expired: .expired
        case .unknown(let value): .unknown(value)
        }
    }
}
