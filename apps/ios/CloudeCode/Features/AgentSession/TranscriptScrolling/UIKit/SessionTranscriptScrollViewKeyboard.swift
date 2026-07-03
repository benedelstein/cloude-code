import UIKit

/// Reports keyboard transitions captured by a transcript scroll view.
protocol SessionTranscriptKeyboardTransitionReporting: AnyObject where Self: UIScrollView {
    /// Most recent keyboard transition waiting to be consumed by transcript layout.
    var pendingKeyboardTransition: KeyboardTransition? { get }

    /// Marks the pending keyboard transition as consumed.
    func clearPendingKeyboardTransition()
}

enum SessionTranscriptKeyboardAnimation {
    /// Returns a keyboard transition only while its UIKit animation is still active.
    static func activeTransition(in scrollView: UIScrollView) -> KeyboardTransition? {
        guard let transitionReporter = scrollView as? any SessionTranscriptKeyboardTransitionReporting,
              let transition = transitionReporter.pendingKeyboardTransition else {
            return nil
        }

        guard transition.remainingDuration <= 0 else {
            return transition
        }

        transitionReporter.clearPendingKeyboardTransition()
        return nil
    }

    /// Runs offset updates using the remaining keyboard transition timing.
    static func animate(
        with keyboardTransition: KeyboardTransition,
        _ animations: @escaping () -> Void
    ) {
        let remainingDuration = keyboardTransition.remainingDuration
        guard remainingDuration > 0 else {
            UIView.performWithoutAnimation(animations)
            return
        }

        UIView.animate(
            withDuration: remainingDuration,
            delay: 0,
            options: keyboardTransition.options,
            animations: animations
        )
    }
}

extension UIScrollView {
    var isInteractivelyDismissingKeyboard: Bool {
        keyboardDismissMode == .interactive && (isTracking || isDragging || isDecelerating)
    }
}
