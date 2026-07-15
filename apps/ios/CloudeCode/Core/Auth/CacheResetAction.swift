import Entities
import Foundation

/// Clears cached data and in-memory state owned by the authenticated user.
@MainActor
struct CacheResetAction {
    private let operation: @MainActor () async throws -> Void

    init(
        cache: Cache,
        userStore: UserStore,
        sessionSummaryStore: SessionSummaryStore,
        repoEnvironmentsStore: RepoEnvironmentsStore,
        sessionMessageStore: SessionMessageStore,
        modelCatalogStore: ModelCatalogStore,
        preferences: NewSessionPreferences,
        homeViewModel: HomeViewModel,
        homeRouter: HomeRouter,
        notificationHandler: NotificationHandler
    ) {
        operation = {
            await homeViewModel.reset()
            userStore.reset()
            sessionSummaryStore.reset()
            repoEnvironmentsStore.reset()
            sessionMessageStore.reset()
            modelCatalogStore.reset()
            preferences.reset()
            homeRouter.reset()
            notificationHandler.reset()

            try await cache.deleteAll(UserEntity.self)
            try await cache.deleteAll(SessionSummaryEntity.self)
            try await cache.deleteAll(RepoEnvironmentEntity.self)
            try await cache.deleteAll(SessionMessageEntity.self)
        }
    }

    init(operation: @escaping @MainActor () async throws -> Void) {
        self.operation = operation
    }

    func callAsFunction() async throws {
        try await operation()
    }
}
