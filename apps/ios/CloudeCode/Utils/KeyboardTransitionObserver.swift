import UIKit
import Domain

/// Keyboard animation metadata captured from UIKit keyboard notifications.
struct KeyboardTransition {
    /// Monotonic system time when the transition was observed.
    let startTime: TimeInterval
    /// Duration reported by the keyboard notification.
    let duration: TimeInterval
    /// UIView animation options derived from the keyboard notification curve.
    let options: UIView.AnimationOptions

    /// Duration left after accounting for time elapsed since observation.
    var remainingDuration: TimeInterval {
        max(0, duration - (ProcessInfo.processInfo.systemUptime - startTime))
    }
}

/// Observes UIKit keyboard notifications and emits parsed transition metadata.
protocol KeyboardTransitionObserving: AnyObject {
    /// Called on the main queue when a keyboard transition notification is received.
    var onTransition: ((KeyboardTransition) -> Void)? { get set }

    /// Starts observing keyboard transitions for a view attached to a window.
    func start(in view: UIView)
    /// Stops observing keyboard transitions and releases the observed view.
    func stop()
}

/// NotificationCenter-backed keyboard transition observer.
final class NotificationKeyboardTransitionObserver: KeyboardTransitionObserving {
    /// Called on the main queue when a keyboard transition notification is received.
    var onTransition: ((KeyboardTransition) -> Void)?

    private let notificationCenter: NotificationCenter
    private weak var view: UIView?
    private var observers: [NSObjectProtocol] = []

    init(notificationCenter: NotificationCenter = .default) {
        self.notificationCenter = notificationCenter
    }

    /// Starts observing keyboard frame and hide notifications for a view.
    func start(in view: UIView) {
        stop()
        self.view = view

        observers = [
            UIResponder.keyboardWillChangeFrameNotification,
            UIResponder.keyboardWillHideNotification
        ].map { name in
            notificationCenter.addObserver(
                forName: name,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                self?.handleKeyboardFrameChange(notification)
            }
        }
    }

    /// Removes active notification observers.
    func stop() {
        observers.forEach { observer in
            notificationCenter.removeObserver(observer)
        }
        observers = []
        view = nil
    }

    // MARK: - PRIVATE

    private func handleKeyboardFrameChange(_ notification: Notification) {
        let transition = KeyboardTransition(
            startTime: ProcessInfo.processInfo.systemUptime,
            duration: keyboardAnimationDuration(from: notification),
            options: keyboardAnimationOptions(from: notification)
        )

        logKeyboardFrameChange(notification, transition: transition)
        onTransition?(transition)
    }

    private func keyboardAnimationDuration(from notification: Notification) -> TimeInterval {
        guard let duration = notification
            .userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber else {
            return 0.25
        }

        return duration.doubleValue
    }

    private func keyboardAnimationOptions(from notification: Notification) -> UIView.AnimationOptions {
        let curveRawValue = (
            notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? NSNumber
        )?.uintValue ?? UInt(UIView.AnimationCurve.easeInOut.rawValue)
        let curveOptions = UIView.AnimationOptions(rawValue: curveRawValue << 16)

        return [.beginFromCurrentState, .allowUserInteraction, .layoutSubviews, curveOptions]
    }

    private func logKeyboardFrameChange(
        _ notification: Notification,
        transition: KeyboardTransition
    ) {
        guard let view,
              let window = view.window,
              let screenFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
            return
        }

        let keyboardFrameInWindow = window.convert(screenFrame, from: nil)
//        Logger.debug(
//            "xx keyboard frame screen=\(screenFrame) " +
//                "window=\(keyboardFrameInWindow) " +
//                "windowBounds=\(window.bounds) " +
//                "duration=\(transition.duration) " +
//                "remainingDuration=\(transition.remainingDuration)"
//        )
    }
}
