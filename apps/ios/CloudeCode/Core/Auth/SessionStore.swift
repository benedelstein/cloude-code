import Domain
import Entities
import Foundation
import Observation

/// Auth state for the UI: drives the root view's loading/signedIn/signedOut
/// switch and exposes the signed-in user.
@MainActor @Observable
final class SessionStore {
    enum State: Equatable {
        case loading
        case signedIn
        case signedOut
    }

    private(set) var state: State = .loading
    private(set) var user: UserModel?
    private let coordinator: TokenCoordinator
    private let userStore: UserStore

    init(coordinator: TokenCoordinator, userStore: UserStore) {
        self.coordinator = coordinator
        self.userStore = userStore
    }

    func start() async {
        if let session = await coordinator.restore() {
            state = .signedIn
            // Cache first, network if missing (UserStore cascade).
            user = try? await userStore.get([session.userId], scopes: .all).first
        } else {
            state = .signedOut
        }

        for await event in coordinator.events {
            switch event {
            case .signedIn(let session):
                state = .signedIn
                user = try? await userStore.get([session.userId], scopes: .all).first
            case .signedOut:
                user = nil
                state = .signedOut
            case .refreshed:
                break
            }
        }
    }

    func signOut() async {
        await coordinator.signOut()
    }

    #if DEBUG
    /// Adopts a placeholder session with an already-stale access token, then
    /// refreshes so real tokens replace the placeholder immediately.
    func injectDevSession(refreshToken: String, userId: String) async {
        let placeholder = Session(
            accessToken: "",
            accessTokenExpiresAt: .distantPast,
            refreshToken: refreshToken,
            refreshTokenExpiresAt: Date().addingTimeInterval(60 * 24 * 60 * 60),
            userId: userId
        )
        await coordinator.adopt(placeholder)
        try? await coordinator.refresh()
    }
    #endif
}
