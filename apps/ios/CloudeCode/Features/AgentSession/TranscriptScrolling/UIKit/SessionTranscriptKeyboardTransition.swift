import UIKit

extension SessionTranscriptCollectionRepresentable.Coordinator {
    /// Returns a keyboard transition only while it can still affect a layout update.
    func unexpiredKeyboardTransition(
        _ transition: KeyboardTransition?,
        in collectionView: LayoutReportingCollectionView?,
        didChangeLayout: Bool
    ) -> KeyboardTransition? {
        guard let transition else { return nil }
        guard !didChangeLayout && transition.remainingDuration <= 0 else {
            return transition
        }

        print("xx clearing expired keyboard transition remainingDuration=\(transition.remainingDuration)")
        collectionView?.clearPendingKeyboardTransition()
        return nil
    }

    /// Clears a keyboard transition after a layout update has consumed it.
    func clearKeyboardTransitionIfNeeded(
        _ collectionView: LayoutReportingCollectionView?,
        _ transition: KeyboardTransition?,
        _ didChangeLayout: Bool
    ) {
        guard transition != nil && didChangeLayout else { return }

        print("xx clearing consumed keyboard transition")
        collectionView?.clearPendingKeyboardTransition()
    }

    /// Runs offset updates using the remaining keyboard transition timing.
    func animateWithKeyboardTransition(
        _ keyboardTransition: KeyboardTransition,
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
