import API
import Domain
import Foundation

private extension Session {
    /// Safe-to-log shape of the token lifecycle (no token material).
    var logDescription: String {
        "user=\(userId) accessExpires=\(accessTokenExpiresAt) refreshExpires=\(refreshTokenExpiresAt)"
    }
}

enum AuthEvent: Sendable {
    case signedIn(Session)
    case refreshed(Session)
    case signedOut
}

private enum TokenCoordinatorError: Error {
    case staleRefreshResult
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
    private let revoker: any SessionRevoking
    private var session: Session?
    private var refreshTask: Task<Session, any Error>?
    private var timerTask: Task<Void, Never>?
    private let continuation: AsyncStream<AuthEvent>.Continuation
    nonisolated let events: AsyncStream<AuthEvent>

    init(
        persistence: any SessionPersisting,
        refresher: any SessionRefreshing,
        revoker: any SessionRevoking
    ) {
        self.persistence = persistence
        self.refresher = refresher
        self.revoker = revoker
        (events, continuation) = AsyncStream.makeStream()
    }

    /// Startup: keychain → nil = signed out; stale access → refresh; valid → arm timer.
    func restore() async -> Session? {
        guard let stored = try? persistence.load() else {
            Logger.debug("Token restore: nothing in keychain")
            return nil
        }
        session = stored
        if stored.isAccessTokenStale() {
            Logger.debug("Token restore: access token stale, refreshing —", stored.logDescription)
            return try? await refresh() // failure → signedOut event already emitted
        }
        Logger.debug("Token restore: access token valid —", stored.logDescription)
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
            try await refresher.refresh(refreshToken: current.refreshToken)
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            Logger.debug("Token refresh: started")
            let fresh = try await task.value
            guard session?.refreshToken == current.refreshToken else {
                throw TokenCoordinatorError.staleRefreshResult
            }
            _adopt(fresh)
            Logger.debug("Token refresh: succeeded —", fresh.logDescription)
            continuation.yield(.refreshed(fresh))
            return fresh
        } catch TokenCoordinatorError.staleRefreshResult {
            Logger.debug("Token refresh: discarded stale result")
            throw APIError.unauthenticated
        } catch APIError.unauthenticated { // refresh token rejected: terminal
            Logger.warning("Token refresh: refresh token rejected, signing out")
            clearSession()
            continuation.yield(.signedOut)
            throw APIError.unauthenticated
        } catch { // other errors: transient, session kept
            Logger.error("Token refresh: transient failure, keeping session —", error)
            throw error
        }
    }

    func adopt(_ new: Session) {
        Logger.debug("Token adopt: new session —", new.logDescription)
        _adopt(new)
        continuation.yield(.signedIn(new))
    }

    func signOut() async {
        let refreshToken = session?.refreshToken
        Logger.debug("Token sign-out: clearing session")
        clearSession()
        continuation.yield(.signedOut)
        guard let refreshToken else { return }
        do {
            try await revoker.logout(refreshToken: refreshToken)
            Logger.debug("Token sign-out: revoked server session")
        } catch {
            Logger.warning("Token sign-out: server revocation failed; local session already cleared", error)
        }
    }

    private func _adopt(_ new: Session) {
        session = new
        try? persistence.save(new)
        scheduleEagerRefresh(for: new)
    }

    private func clearSession() {
        session = nil
        try? persistence.clear()
        refreshTask?.cancel()
        refreshTask = nil
        timerTask?.cancel()
        timerTask = nil
    }

    /// Refresh 2 minutes ahead of expiry, anchored to a clock deadline so the
    /// fire time doesn't drift with suspension.
    private func scheduleEagerRefresh(for session: Session) {
        timerTask?.cancel()
        let fireIn = max(1, session.accessTokenExpiresAt.timeIntervalSinceNow - 120)
        Logger.debug("Token timer: eager refresh in", Int(fireIn), "seconds")
        let deadline = ContinuousClock.now + .seconds(fireIn)
        timerTask = Task { [weak self] in
            try? await Task.sleep(until: deadline)
            guard !Task.isCancelled else { return }
            _ = try? await self?.refresh() // transient failure → on-demand path covers
        }
    }
}
