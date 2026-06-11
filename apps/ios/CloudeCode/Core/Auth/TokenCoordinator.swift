import API
import Domain
import Foundation

enum AuthEvent: Sendable {
    case signedIn(Session)
    case refreshed(Session)
    case signedOut
}

/// Owns the session value, keychain writes, the eager refresh timer, and the
/// single-flight refresh mutex. Both refresh paths (timer + on-demand from
/// `authToken()`) converge on `refresh()`; concurrent callers await the same
/// in-flight task. Re-entrancy is structurally impossible: the refresh
/// request carries no auth header, so refreshing never calls back into
/// `authToken()`.
actor TokenCoordinator: AuthTokenProviding {
    private let persistence: any SessionPersisting
    private let refresher: any SessionRefreshing
    private var session: Session?
    private var refreshTask: Task<Session, any Error>?
    private var timerTask: Task<Void, Never>?
    private let continuation: AsyncStream<AuthEvent>.Continuation
    nonisolated let events: AsyncStream<AuthEvent>

    init(persistence: any SessionPersisting, refresher: any SessionRefreshing) {
        self.persistence = persistence
        self.refresher = refresher
        (events, continuation) = AsyncStream.makeStream()
    }

    /// Startup: keychain → nil = signed out; stale access → refresh; valid → arm timer.
    func restore() async -> Session? {
        guard let stored = try? persistence.load() else { return nil }
        session = stored
        if stored.isAccessTokenStale() {
            return try? await refresh() // failure → signedOut event already emitted
        }
        scheduleEagerRefresh(for: stored)
        return stored
    }

    // AuthTokenProviding — every authed API request lands here.
    func authToken() async throws -> String? {
        guard let session else { return nil }
        guard session.isAccessTokenStale() else { return session.accessToken }
        return try await refresh().accessToken
    }

    @discardableResult
    func refresh() async throws -> Session {
        if let inFlight = refreshTask { return try await inFlight.value } // idempotent
        guard let current = session else { throw APIError.unauthenticated }
        let task = Task { [refresher] in
            try await refresher.refresh(refreshToken: current.refreshToken, userId: current.userId)
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let fresh = try await task.value
            adoptInternal(fresh)
            continuation.yield(.refreshed(fresh))
            return fresh
        } catch APIError.unauthenticated { // refresh token rejected: terminal
            clearSession()
            continuation.yield(.signedOut)
            throw APIError.unauthenticated
        } // other errors: transient, session kept
    }

    func adopt(_ new: Session) { // dev injection now, real login later
        adoptInternal(new)
        continuation.yield(.signedIn(new))
    }

    func signOut() {
        clearSession()
        continuation.yield(.signedOut)
    }

    private func adoptInternal(_ new: Session) {
        session = new
        try? persistence.save(new)
        scheduleEagerRefresh(for: new)
    }

    private func clearSession() {
        session = nil
        try? persistence.clear()
        timerTask?.cancel()
        timerTask = nil
    }

    /// Refresh 2 minutes ahead of expiry, anchored to a clock deadline so the
    /// fire time doesn't drift with suspension.
    private func scheduleEagerRefresh(for session: Session) {
        timerTask?.cancel()
        let fireIn = max(1, session.accessTokenExpiresAt.timeIntervalSinceNow - 120)
        let deadline = ContinuousClock.now + .seconds(fireIn)
        timerTask = Task { [weak self] in
            try? await Task.sleep(until: deadline)
            guard !Task.isCancelled else { return }
            _ = try? await self?.refresh() // transient failure → on-demand path covers
        }
    }
}
