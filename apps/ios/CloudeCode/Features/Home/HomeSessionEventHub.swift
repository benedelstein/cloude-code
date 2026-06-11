import CoreAPI
import Foundation

enum HomeSessionEvent: Sendable {
    case created(CoreAPI.SessionSummary)
    case updated(CoreAPI.SessionSummary)
    case removed(UUID)
}

actor HomeSessionEventHub {
    private var continuations: [UUID: AsyncStream<HomeSessionEvent>.Continuation] = [:]

    func events() -> AsyncStream<HomeSessionEvent> {
        AsyncStream { continuation in
            let id = UUID()
            continuations[id] = continuation
            continuation.onTermination = { [weak self] _ in
                Task {
                    await self?.removeContinuation(id)
                }
            }
        }
    }

    func sessionCreated(_ session: CoreAPI.SessionSummary) {
        yield(.created(session))
    }

    func sessionUpdated(_ session: CoreAPI.SessionSummary) {
        yield(.updated(session))
    }

    func sessionRemoved(_ sessionID: UUID) {
        yield(.removed(sessionID))
    }

    private func yield(_ event: HomeSessionEvent) {
        for continuation in continuations.values {
            continuation.yield(event)
        }
    }

    private func removeContinuation(_ id: UUID) {
        continuations[id] = nil
    }
}
