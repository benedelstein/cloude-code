import Combine
import Domain
import Foundation

/// Resets user-scoped caches whenever authentication resolves to signed out.
@MainActor
final class CacheResetWorker: Worker {
    private let cacheResetAction: CacheResetAction
    private let authStatePublisher: AnyPublisher<SessionStore.State, Never>
    private var cancellables = Set<AnyCancellable>()

    init(
        cacheResetAction: CacheResetAction,
        authStatePublisher: AnyPublisher<SessionStore.State, Never>
    ) {
        self.cacheResetAction = cacheResetAction
        self.authStatePublisher = authStatePublisher
    }

    override func didStart() {
        authStatePublisher
            .removeDuplicates()
            .sink { [cacheResetAction] state in
                guard state == .signedOut else { return }
                Task { @MainActor in
                    Logger.debug("resetting cache due to sign out")
                    do {
                        try await cacheResetAction()
                    } catch {
                        Logger.warning("Failed to reset signed-out cache", error)
                    }
                }
            }
            .store(in: &cancellables)
    }

    override func didStop() {
        cancellables.removeAll()
    }
}
