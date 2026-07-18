import API
import CoreAPI
import Domain
import Foundation
import Observation

/// Observable state and effects for provider-specific native connection flows.
@MainActor
@Observable
final class ProviderConnectionViewModel {
    enum Phase: Equatable {
        case ready
        case claudeCodeEntry
        case openAIWaiting(OpenAIDeviceAuthorization)
        case connected
    }

    struct ExternalAuthorization: Equatable {
        let url: URL
        let codeToCopy: String?
    }

    let context: ProviderConnectionContext
    private let api: any ProviderAuthAPIProviding
    private let modelCatalogStore: ModelCatalogStore
    private let pollIntervalOverride: Duration?
    private var claudeState: String?
    @ObservationIgnored private var connectionTask: Task<Void, Never>?
    @ObservationIgnored private var pollTask: Task<Void, Never>?

    private(set) var phase: Phase = .ready
    private(set) var isWorking = false
    private(set) var externalAuthorization: ExternalAuthorization?
    var claudeCode = ""
    var errorMessage: String?

    var isConnected: Bool {
        phase == .connected
    }

    init(
        context: ProviderConnectionContext,
        api: any ProviderAuthAPIProviding,
        modelCatalogStore: ModelCatalogStore,
        pollIntervalOverride: Duration? = nil
    ) {
        self.context = context
        self.api = api
        self.modelCatalogStore = modelCatalogStore
        self.pollIntervalOverride = pollIntervalOverride
    }

    /// Starts the configured provider flow and opens its external authorization page.
    func connect() {
        guard connectionTask == nil, pollTask == nil else { return }
        errorMessage = nil
        isWorking = true

        connectionTask = Task { [weak self] in
            guard let self else { return }
            defer {
                isWorking = false
                connectionTask = nil
            }

            do {
                let authorization = try await prepareExternalAuthorization()
                try Task.checkCancellation()
                externalAuthorization = authorization
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Reopens the current OpenAI Codex authorization page and recopies its code.
    func reopenOpenAIAuthorization() {
        guard case .openAIWaiting(let authorization) = phase,
              let url = URL(string: authorization.verificationURL) else {
            return
        }
        externalAuthorization = ExternalAuthorization(
            url: url,
            codeToCopy: authorization.userCode
        )
    }

    /// Clears an external authorization request after the view opens it.
    func didOpenExternalAuthorization() {
        externalAuthorization = nil
    }

    /// Submits the code copied from Claude and completes the connection.
    func submitClaudeCode() {
        let code = claudeCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard connectionTask == nil, let claudeState, !code.isEmpty else { return }
        errorMessage = nil
        isWorking = true

        connectionTask = Task { [weak self] in
            guard let self else { return }
            defer {
                isWorking = false
                connectionTask = nil
            }

            do {
                try await api.exchangeClaudeCode(
                    code: code,
                    state: claudeState,
                    sessionId: context.sessionId
                )
                try Task.checkCancellation()
                await finishConnection()
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Returns the Claude flow to its initial state.
    func cancelClaudeCodeEntry() {
        guard !isWorking else { return }
        claudeState = nil
        claudeCode = ""
        errorMessage = nil
        phase = .ready
    }

    /// Cancels in-flight requests and polling when the sheet disappears.
    func unload() {
        connectionTask?.cancel()
        connectionTask = nil
        pollTask?.cancel()
        pollTask = nil
        externalAuthorization = nil
        isWorking = false
    }

    private func beginOpenAIPolling(_ authorization: OpenAIDeviceAuthorization) {
        pollTask = Task { [weak self] in
            guard let self else { return }
            defer { pollTask = nil }

            do {
                while !Task.isCancelled {
                    let interval = pollIntervalOverride
                        ?? .seconds(max(authorization.intervalSeconds, 1))
                    try await Task.sleep(for: interval)
                    let status = try await api.pollOpenAIDeviceAuthorization(
                        attemptId: authorization.attemptId,
                        sessionId: context.sessionId
                    )
                    switch status {
                    case .pending:
                        continue
                    case .completed:
                        await finishConnection()
                        return
                    case .expired:
                        phase = .ready
                        errorMessage = ProviderConnectionError.authorizationExpired.localizedDescription
                        return
                    case .unknown(let value):
                        throw ProviderConnectionError.unknownAuthorizationStatus(value)
                    }
                }
            } catch is CancellationError {
                return
            } catch {
                phase = .ready
                errorMessage = error.localizedDescription
            }
        }
    }

    private func prepareExternalAuthorization() async throws -> ExternalAuthorization {
        switch context.providerId {
        case .claudeCode:
            let authorization = try await api.claudeAuthorization()
            try Task.checkCancellation()
            guard let url = URL(string: authorization.url) else {
                throw ProviderConnectionError.invalidAuthorizationURL
            }
            claudeState = authorization.state
            phase = .claudeCodeEntry
            return ExternalAuthorization(url: url, codeToCopy: nil)

        case .openaiCodex:
            let authorization = try await api.startOpenAIDeviceAuthorization()
            try Task.checkCancellation()
            guard let url = URL(string: authorization.verificationURL) else {
                throw ProviderConnectionError.invalidAuthorizationURL
            }
            phase = .openAIWaiting(authorization)
            beginOpenAIPolling(authorization)
            return ExternalAuthorization(url: url, codeToCopy: authorization.userCode)

        case .unknown:
            throw ProviderConnectionError.unsupportedProvider
        }
    }

    private func finishConnection() async {
        modelCatalogStore.reset()
        await modelCatalogStore.load()
        phase = .connected
    }
}

private enum ProviderConnectionError: LocalizedError {
    case invalidAuthorizationURL
    case unsupportedProvider
    case authorizationExpired
    case unknownAuthorizationStatus(String)

    var errorDescription: String? {
        switch self {
        case .invalidAuthorizationURL:
            "The provider returned an invalid authorization URL."
        case .unsupportedProvider:
            "This provider cannot be connected in this version of the app."
        case .authorizationExpired:
            "The authorization code expired. Try connecting again."
        case .unknownAuthorizationStatus(let status):
            "The provider returned an unknown authorization status: \(status)."
        }
    }
}
