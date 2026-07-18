import API
import CoreAPI
import Domain
import Foundation
import Testing
@testable import CloudeCode

@MainActor
struct ProviderConnectionViewModelTests {
    @Test func claudeFlowOpensAuthorizationAndExchangesPastedCode() async throws {
        let authAPI = ProviderAuthAPISpy()
        let modelsAPI = ProviderConnectionModelsAPISpy()
        let viewModel = makeViewModel(
            providerId: .claudeCode,
            sessionId: "session-1",
            authAPI: authAPI,
            modelsAPI: modelsAPI
        )

        viewModel.connect()
        try await waitUntil { viewModel.phase == .claudeCodeEntry }

        #expect(viewModel.externalAuthorization?.url.absoluteString == "https://claude.ai/oauth/authorize")
        #expect(viewModel.externalAuthorization?.codeToCopy == nil)

        viewModel.didOpenExternalAuthorization()
        viewModel.claudeCode = "  claude-code  "
        viewModel.submitClaudeCode()
        try await waitUntil { viewModel.isConnected }

        #expect(authAPI.claudeExchange?.code == "claude-code")
        #expect(authAPI.claudeExchange?.state == "claude-state")
        #expect(authAPI.claudeExchange?.sessionId == "session-1")
        #expect(modelsAPI.callCount == 1)
    }

    @Test func openAIFlowCopiesCodeAndPollsThroughCompletion() async throws {
        let authAPI = ProviderAuthAPISpy(openAIStatuses: [.pending, .completed])
        let modelsAPI = ProviderConnectionModelsAPISpy()
        let viewModel = makeViewModel(
            providerId: .openaiCodex,
            sessionId: "session-2",
            authAPI: authAPI,
            modelsAPI: modelsAPI
        )

        viewModel.connect()
        try await waitUntil { viewModel.externalAuthorization != nil }

        #expect(viewModel.externalAuthorization?.url.absoluteString == "https://auth.openai.com/device")
        #expect(viewModel.externalAuthorization?.codeToCopy == "ABCD-EFGH")

        viewModel.didOpenExternalAuthorization()
        try await waitUntil { viewModel.isConnected }

        #expect(authAPI.openAIPollCount == 2)
        #expect(authAPI.lastOpenAIAttemptId == "attempt-1")
        #expect(authAPI.lastOpenAISessionId == "session-2")
        #expect(modelsAPI.callCount == 1)
    }

    @Test func expiredOpenAIAuthorizationReturnsToReadyWithError() async throws {
        let authAPI = ProviderAuthAPISpy(openAIStatuses: [.expired])
        let viewModel = makeViewModel(
            providerId: .openaiCodex,
            sessionId: nil,
            authAPI: authAPI,
            modelsAPI: ProviderConnectionModelsAPISpy()
        )

        viewModel.connect()
        try await waitUntil { viewModel.errorMessage != nil }

        #expect(viewModel.phase == .ready)
        #expect(viewModel.errorMessage == "The authorization code expired. Try connecting again.")
        #expect(!viewModel.isConnected)
    }

    private func makeViewModel(
        providerId: ProviderId,
        sessionId: String?,
        authAPI: ProviderAuthAPISpy,
        modelsAPI: ProviderConnectionModelsAPISpy
    ) -> ProviderConnectionViewModel {
        ProviderConnectionViewModel(
            context: ProviderConnectionContext(
                providerId: providerId,
                providerName: providerId == .claudeCode ? "Claude" : "OpenAI Codex",
                requiresReauth: false,
                sessionId: sessionId
            ),
            api: authAPI,
            modelCatalogStore: ModelCatalogStore(modelsAPI: modelsAPI),
            pollIntervalOverride: .milliseconds(1)
        )
    }

    private func waitUntil(_ condition: @MainActor () -> Bool) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        throw ProviderConnectionTestError.timedOut
    }
}

@MainActor
private final class ProviderAuthAPISpy: ProviderAuthAPIProviding {
    struct ClaudeExchange: Equatable {
        let code: String
        let state: String
        let sessionId: String?
    }

    private var openAIStatuses: [OpenAIDeviceAuthorizationStatus]
    private(set) var claudeExchange: ClaudeExchange?
    private(set) var openAIPollCount = 0
    private(set) var lastOpenAIAttemptId: String?
    private(set) var lastOpenAISessionId: String?

    init(openAIStatuses: [OpenAIDeviceAuthorizationStatus] = []) {
        self.openAIStatuses = openAIStatuses
    }

    func claudeAuthorization() async throws -> ProviderAuthorization {
        ProviderAuthorization(
            url: "https://claude.ai/oauth/authorize",
            state: "claude-state"
        )
    }

    func exchangeClaudeCode(code: String, state: String, sessionId: String?) async throws {
        claudeExchange = ClaudeExchange(code: code, state: state, sessionId: sessionId)
    }

    func startOpenAIDeviceAuthorization() async throws -> OpenAIDeviceAuthorization {
        OpenAIDeviceAuthorization(
            attemptId: "attempt-1",
            verificationURL: "https://auth.openai.com/device",
            userCode: "ABCD-EFGH",
            intervalSeconds: 5
        )
    }

    func pollOpenAIDeviceAuthorization(
        attemptId: String,
        sessionId: String?
    ) async throws -> OpenAIDeviceAuthorizationStatus {
        openAIPollCount += 1
        lastOpenAIAttemptId = attemptId
        lastOpenAISessionId = sessionId
        return openAIStatuses.isEmpty ? .pending : openAIStatuses.removeFirst()
    }
}

@MainActor
private final class ProviderConnectionModelsAPISpy: ModelsAPIProviding {
    private(set) var callCount = 0

    func models() async throws -> ModelsResponse {
        callCount += 1
        return ModelsResponse(providers: [])
    }
}

private enum ProviderConnectionTestError: Error {
    case timedOut
}
