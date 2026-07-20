import API
import Domain
import Foundation
import Observation

/// State and effects for the OpenAI Codex device-code connection flow.
@MainActor
@Observable
final class OpenAIProviderConnectionViewModel {
    enum Phase: Equatable {
        case ready
        case preparing
        case codeReady(OpenAIDeviceAuthorization)
        case waiting(OpenAIDeviceAuthorization)
        case connected
    }

    let context: ProviderConnectionContext
    private let api: any ProviderAuthAPIProviding
    private let modelCatalogStore: ModelCatalogStore
    private let pollIntervalOverride: Duration?
    @ObservationIgnored private var preparationTask: Task<Void, Never>?
    @ObservationIgnored private var pollTask: Task<Void, Never>?

    private(set) var phase: Phase = .ready
    var errorMessage: String?

    var authorization: OpenAIDeviceAuthorization? {
        switch phase {
        case .codeReady(let authorization), .waiting(let authorization):
            authorization
        case .ready, .preparing, .connected:
            nil
        }
    }

    var isPreparing: Bool {
        phase == .preparing
    }

    var isWaiting: Bool {
        if case .waiting = phase {
            return true
        }
        return false
    }

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

    /// Loads the device code shown when the connection screen appears.
    func load() {
        guard phase == .ready, preparationTask == nil, pollTask == nil else { return }
        Logger.info("OpenAI device authorization load started")
        errorMessage = nil
        phase = .preparing

        preparationTask = Task { [weak self] in
            guard let self else { return }
            defer { preparationTask = nil }

            do {
                let authorization = try await api.startOpenAIDeviceAuthorization()
                try Task.checkCancellation()
                guard URL(string: authorization.verificationURL) != nil else {
                    throw OpenAIProviderConnectionError.invalidAuthorizationURL
                }
                Logger.info("OpenAI device authorization load completed")
                phase = .codeReady(authorization)
            } catch is CancellationError {
                Logger.info("OpenAI device authorization load cancelled")
                return
            } catch {
                Logger.error("OpenAI device authorization load failed", error)
                phase = .ready
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Starts polling after the user opens the prepared authorization URL.
    func didOpenAuthorization() {
        guard case .codeReady(let authorization) = phase else { return }
        phase = .waiting(authorization)
        beginPolling(authorization)
    }

    /// Cancels in-flight requests and polling when the sheet disappears.
    func unload() {
        preparationTask?.cancel()
        preparationTask = nil
        pollTask?.cancel()
        pollTask = nil
    }

    private func beginPolling(_ authorization: OpenAIDeviceAuthorization) {
        guard pollTask == nil else { return }
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
                    try Task.checkCancellation()

                    guard try await handle(status) else { return }
                }
            } catch is CancellationError {
                return
            } catch {
                phase = .ready
                errorMessage = error.localizedDescription
            }
        }
    }

    private func handle(_ status: OpenAIDeviceAuthorizationStatus) async throws -> Bool {
        switch status {
        case .pending:
            return true
        case .completed:
            await finishConnection()
            return false
        case .expired:
            phase = .ready
            errorMessage = OpenAIProviderConnectionError.authorizationExpired.localizedDescription
            return false
        case .unknown(let value):
            throw OpenAIProviderConnectionError.unknownAuthorizationStatus(value)
        }
    }

    private func finishConnection() async {
        modelCatalogStore.reset()
        await modelCatalogStore.load()
        guard !Task.isCancelled else { return }
        phase = .connected
    }
}

private enum OpenAIProviderConnectionError: LocalizedError {
    case invalidAuthorizationURL
    case authorizationExpired
    case unknownAuthorizationStatus(String)

    var errorDescription: String? {
        switch self {
        case .invalidAuthorizationURL:
            "OpenAI returned an invalid authorization URL."
        case .authorizationExpired:
            "The authorization code expired. Try connecting again."
        case .unknownAuthorizationStatus(let status):
            "OpenAI returned an unknown authorization status: \(status)."
        }
    }
}
