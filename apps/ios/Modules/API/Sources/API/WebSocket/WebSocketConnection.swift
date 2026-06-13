import Domain
import Foundation

/// Lifecycle of a `WebSocketConnection`.
public enum WebSocketConnectionState: Sendable, Equatable {
    case connecting
    case connected
    case disconnected
}

/// Raw transport events emitted by `WebSocketConnection`.
public enum WebSocketTransportEvent: Sendable {
    case stateChanged(WebSocketConnectionState)
    case message(Data)
}

/// Reconnecting WebSocket transport over `URLSessionWebSocketTask`.
///
/// Owns the receive loop and an exponential-backoff reconnect loop
/// (1s doubling to 30s, reset on a successful upgrade). The upgrade URL is
/// re-resolved on every attempt so short-lived `?token=` credentials are
/// refreshed. Frames are surfaced raw; typed decoding lives in the
/// protocol-specific sockets. `events` is a single-consumer stream.
public actor WebSocketConnection {
    public nonisolated let events: AsyncStream<WebSocketTransportEvent>

    private let makeURL: @Sendable () async throws -> URL
    private let urlSession: URLSession
    private let continuation: AsyncStream<WebSocketTransportEvent>.Continuation

    private var socketTask: URLSessionWebSocketTask?
    private var runTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var retryCount = 0
    private var isStopped = true

    private static let maxRetryDelaySeconds: Double = 30
    private static let pingInterval: Duration = .seconds(20)

    public init(
        urlSession: URLSession = .shared,
        makeURL: @escaping @Sendable () async throws -> URL
    ) {
        self.urlSession = urlSession
        self.makeURL = makeURL
        (events, continuation) = AsyncStream.makeStream()
    }

    /// Starts the connect/receive/reconnect loop. No-op while already running.
    public func connect() {
        // `isStopped` is false exactly while `runTask` is alive: the two are
        // only flipped together (here and in `disconnect`), and `run()` only
        // exits via `disconnect`. So this guard prevents a double-start.
        guard isStopped else { return }
        isStopped = false
        retryCount = 0
        runTask = Task { await run() }
    }

    /// Stops reconnecting and closes the current socket.
    public func disconnect() {
        isStopped = true
        runTask?.cancel()
        runTask = nil
        stopPinging()
        socketTask?.cancel(with: .normalClosure, reason: nil)
        socketTask = nil
        continuation.yield(.stateChanged(.disconnected))
    }

    public func send(text: String) async throws {
        guard let socketTask else {
            throw APIError.webSocketNotConnected
        }
        try await socketTask.send(.string(text))
    }

    private func run() async {
        while !Task.isCancelled, !isStopped {
            continuation.yield(.stateChanged(.connecting))
            do {
                let url = try await makeURL()
                Logger.debug("websocket connecting to", url.sanitizedWebSocketLogString)
                let task = urlSession.webSocketTask(with: url)
                task.resume()
                socketTask = task
                Logger.debug("websocket task resumed")
                retryCount = 0
                continuation.yield(.stateChanged(.connected))
                startPinging(task)
                try await receiveLoop(on: task)
            } catch {
                // Fall through to backoff; covers failed upgrades and drops.
                Logger.warning("WebSocket connection lost:", error)
            }
            stopPinging()
            socketTask?.cancel(with: .normalClosure, reason: nil)
            Logger.debug("websocket closed normally")
            socketTask = nil
            guard !Task.isCancelled, !isStopped else { return }
            continuation.yield(.stateChanged(.disconnected))
            await backoff()
        }
    }

    private func receiveLoop(on task: URLSessionWebSocketTask) async throws {
        while !Task.isCancelled {
            switch try await task.receive() {
            case .string(let text):
                continuation.yield(.message(Data(text.utf8)))
            case .data(let data):
                continuation.yield(.message(data))
            @unknown default:
                break
            }
        }
    }

    private func backoff() async {
        let delay = min(pow(2, Double(retryCount)), Self.maxRetryDelaySeconds)
        retryCount += 1
        try? await Task.sleep(for: .seconds(delay))
    }

    private func startPinging(_ task: URLSessionWebSocketTask) {
        // Deadline-based sleeps, not a Timer: advancing `nextPing` from the
        // schedule (instead of "now + interval") keeps the cadence drift-free
        // like a repeating Timer, while staying actor-isolated and cancelling
        // instantly via pingTask.
        pingTask = Task {
            var nextPing = ContinuousClock.now + Self.pingInterval
            while !Task.isCancelled {
                // Loose tolerance is fine power-wise; deadlines can't drift
                // because the next one is anchored to the schedule.
                try? await Task.sleep(until: nextPing, tolerance: .seconds(2))
                nextPing += Self.pingInterval
                guard !Task.isCancelled else { return }
                // Failures surface through the receive loop; ignore here.
                try? await Self.awaitPong(task)
            }
        }
    }

    private func stopPinging() {
        pingTask?.cancel()
        pingTask = nil
    }

    private static func awaitPong(_ task: URLSessionWebSocketTask) async throws {
        try await withCheckedThrowingContinuation { (checked: CheckedContinuation<Void, any Error>) in
            let continuation = OneShotContinuation(checked)
            task.sendPing { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
}

private final class OneShotContinuation: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, any Error>?

    init(_ continuation: CheckedContinuation<Void, any Error>) {
        self.continuation = continuation
    }

    func resume() {
        guard let continuation = take() else {
            Logger.warning("WebSocket ping completion fired after continuation was already resumed")
            return
        }
        continuation.resume()
    }

    func resume(throwing error: any Error) {
        guard let continuation = take() else {
            Logger.warning("WebSocket ping completion fired after continuation was already resumed", error)
            return
        }
        continuation.resume(throwing: error)
    }

    private func take() -> CheckedContinuation<Void, any Error>? {
        lock.withLock {
            let result = continuation
            continuation = nil
            return result
        }
    }
}

private extension URL {
    var sanitizedWebSocketLogString: String {
        guard var components = URLComponents(url: self, resolvingAgainstBaseURL: false) else {
            return absoluteString
        }
        components.queryItems = components.queryItems?.map { item in
            item.name == "token" ? URLQueryItem(name: item.name, value: "<redacted>") : item
        }
        return components.string ?? absoluteString
    }
}

enum WebSocketURLBuilder {
    /// Converts the HTTP API base URL into a `ws(s)` upgrade URL with the
    /// short-lived token in the query string, matching the web clients.
    static func url(baseURL: URL, path: String, token: String) throws -> URL {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: true) else {
            throw APIError.invalidURL
        }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = components.path
            .appending("/")
            .appending(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components.url else {
            throw APIError.invalidURL
        }
        return url
    }
}
