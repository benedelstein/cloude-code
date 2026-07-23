import CoreHaptics
import Domain
import Foundation
import UIKit

@MainActor
protocol AgentSessionHapticFeedbackProviding: AnyObject {
    func prepare()
    func turnStarted()
    func turnCompleted()
    func stop()
}

@MainActor
final class AgentSessionHapticFeedback: AgentSessionHapticFeedbackProviding {
    private let turnStartGenerator: UIImpactFeedbackGenerator
    private let completionPatternURL: URL?
    private let hapticEngine: CHHapticEngine?

    init(
        turnStartGenerator: UIImpactFeedbackGenerator = .init(style: .light),
        bundle: Bundle = .main
    ) {
        self.turnStartGenerator = turnStartGenerator
        completionPatternURL = bundle.url(
            forResource: "TurnCompletion",
            withExtension: "ahap"
        )
        hapticEngine = Self.makeHapticEngine()
    }

    func prepare() {
        guard let hapticEngine else {
            return
        }
        do {
            try hapticEngine.start()
        } catch {
            Logger.warning("Failed to prepare agent session haptic engine:", error)
        }
    }

    func turnStarted() {
        turnStartGenerator.impactOccurred()
    }

    func turnCompleted() {
        guard let hapticEngine, let completionPatternURL else {
            return
        }
        do {
            try hapticEngine.start()
            try hapticEngine.playPattern(from: completionPatternURL)
        } catch {
            Logger.warning("Failed to play agent turn completion haptic:", error)
        }
    }

    func stop() {
        hapticEngine?.stop(completionHandler: nil)
    }

    private static func makeHapticEngine() -> CHHapticEngine? {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            return nil
        }
        do {
            return try CHHapticEngine()
        } catch {
            Logger.warning("Failed to create agent session haptic engine:", error)
            return nil
        }
    }
}
