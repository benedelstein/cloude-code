import Foundation

/// Delay policy applied between failed task attempts.
enum RetryBackoffStrategy: Sendable {
    case immediate
    case constant(Duration)
    case linear(initial: Duration, increment: Duration, maximum: Duration)
    case exponential(initial: Duration, maximum: Duration)

    func delay(afterFailedAttempt attempt: Int) -> Duration {
        switch self {
        case .immediate:
            return .zero
        case .constant(let delay):
            return max(.zero, delay)
        case let .linear(initial, increment, maximum):
            let maximum = max(.zero, maximum)
            let increment = max(.zero, increment)
            var delay = min(max(.zero, initial), maximum)
            for _ in 1..<max(1, attempt) {
                delay = min(delay + increment, maximum)
            }
            return delay
        case let .exponential(initial, maximum):
            let maximum = max(.zero, maximum)
            var delay = min(max(.zero, initial), maximum)
            for _ in 1..<max(1, attempt) {
                delay = min(delay + delay, maximum)
            }
            return delay
        }
    }
}

extension Task where Failure == Error {
    /// Creates a task that retries matching failures up to `maxAttempts`.
    static func retrying(
        maxAttempts: Int = 3,
        backoff: RetryBackoffStrategy = .immediate,
        priority: TaskPriority? = nil,
        shouldRetry: @Sendable @escaping (any Error) -> Bool = { _ in true },
        operation: @Sendable @escaping () async throws -> Success
    ) -> Task<Success, any Error> {
        let attemptLimit = max(1, maxAttempts)
        return Task(priority: priority) {
            for attempt in 1...attemptLimit {
                try Task<Never, Never>.checkCancellation()
                do {
                    return try await operation()
                } catch {
                    try Task<Never, Never>.checkCancellation()
                    guard attempt < attemptLimit, shouldRetry(error) else {
                        throw error
                    }
                    let delay = backoff.delay(afterFailedAttempt: attempt)
                    if delay > .zero {
                        try await Task<Never, Never>.sleep(for: delay)
                    }
                }
            }
            preconditionFailure("Retry loop must return or throw")
        }
    }
}
