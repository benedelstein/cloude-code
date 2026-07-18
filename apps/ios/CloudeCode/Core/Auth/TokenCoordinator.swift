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

enum SessionRestoreResult: Sendable, Equatable {
    case signedOut
    case ready(Session)
    case needsRefresh(Session)
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
    private let refreshRetryBaseInterval: TimeInterval
    private var session: Session?
    private var refreshTask: Task<Session, any Error>?
    private var timerTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var refreshRetryAttempt = 0
    private let continuation: AsyncStream<AuthEvent>.Continuation
    nonisolated let events: AsyncStream<AuthEvent>

    init(
        persistence: any SessionPersisting,
        refresher: any SessionRefreshing,
        revoker: any SessionRevoking,
        refreshRetryBaseInterval: TimeInterval = 1
    ) {
        self.persistence = persistence
        self.refresher = refresher
        self.revoker = revoker
        self.refreshRetryBaseInterval = refreshRetryBaseInterval
        (events, continuation) = AsyncStream.makeStream()
    }

    /// Restores local credentials without waiting for network access.
    func restore() -> SessionRestoreResult {
        let stored: Session?
        do {
            stored = try persistence.load()
        } catch {
            Logger.warning("Token restore: failed to load persisted session", error)
            return .signedOut
        }
        guard let stored else {
            Logger.debug("Token restore: nothing in keychain")
            return .signedOut
        }
        session = stored
        guard !stored.isAccessTokenStale() else {
            Logger.debug("Token restore: access token stale —", stored.logDescription)
            return .needsRefresh(stored)
        }
        Logger.debug("Token restore: access token valid —", stored.logDescription)
        scheduleEagerRefresh(for: stored)
        return .ready(stored)
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
            Logger.warning("refresh token rejected, signing out")
            clearSession()
            continuation.yield(.signedOut)
            throw APIError.unauthenticated
        } catch { // other errors: transient, session kept and retried
            Logger.error("Token refresh: transient failure, keeping session —", error)
            scheduleRefreshRetry()
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
        cancelRefreshRetry()
        do {
            try persistence.save(new)
        } catch {
            Logger.warning("Token persistence: failed to save session", error)
        }
        scheduleEagerRefresh(for: new)
    }

    private func clearSession() {
        session = nil
        do {
            try persistence.clear()
        } catch {
            Logger.warning("Token persistence: failed to clear session", error)
        }
        refreshTask?.cancel()
        refreshTask = nil
        timerTask?.cancel()
        timerTask = nil
        cancelRefreshRetry()
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
            _ = try? await self?.refresh()
        }
    }

    private func scheduleRefreshRetry() {
        retryTask?.cancel()
        let exponent = min(refreshRetryAttempt, 5)
        let delay = min(refreshRetryBaseInterval * pow(2, Double(exponent)), 30)
        refreshRetryAttempt += 1
        Logger.debug("Token refresh: retrying in", delay, "seconds")
        let deadline = ContinuousClock.now + .seconds(delay)
        retryTask = Task { [weak self] in
            try? await Task.sleep(until: deadline)
            guard !Task.isCancelled else { return }
            _ = try? await self?.refresh()
        }
    }

    private func cancelRefreshRetry() {
        retryTask?.cancel()
        retryTask = nil
        refreshRetryAttempt = 0
    }
}
