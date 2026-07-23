import Foundation
import UIKit

@MainActor
protocol AgentSessionHapticFeedbackProviding: AnyObject {
    func turnStarted()
    func turnCompleted()
    func cancelPendingFeedback()
}

@MainActor
final class AgentSessionHapticFeedback: AgentSessionHapticFeedbackProviding {
    private static let completionPulseDelay = Duration.milliseconds(140)

    private let turnStartGenerator: UIImpactFeedbackGenerator
    private let turnCompletionGenerator: UIImpactFeedbackGenerator
    private var completionTask: Task<Void, Never>?

    init(
        turnStartGenerator: UIImpactFeedbackGenerator = .init(style: .light),
        turnCompletionGenerator: UIImpactFeedbackGenerator = .init(style: .medium)
    ) {
        self.turnStartGenerator = turnStartGenerator
        self.turnCompletionGenerator = turnCompletionGenerator
    }

    func turnStarted() {
        turnStartGenerator.impactOccurred()
    }

    func turnCompleted() {
        completionTask?.cancel()
        turnCompletionGenerator.prepare()
        turnCompletionGenerator.impactOccurred(intensity: 0.75)
        turnCompletionGenerator.prepare()

        completionTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(for: Self.completionPulseDelay)
            } catch {
                return
            }
            guard let self else {
                return
            }
            turnCompletionGenerator.impactOccurred()
            completionTask = nil
        }
    }

    func cancelPendingFeedback() {
        completionTask?.cancel()
        completionTask = nil
    }
}
