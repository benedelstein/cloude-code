import UIKit

extension SessionTranscriptCollectionRepresentable.Coordinator {
    /// Returns a keyboard transition only while its UIKit animation is still active.
    func activeKeyboardTransition(
        _ transition: KeyboardTransition?,
        in collectionView: LayoutReportingCollectionView?
    ) -> KeyboardTransition? {
        guard let transition else { return nil }
        guard transition.remainingDuration <= 0 else {
            return transition
        }

        collectionView?.clearPendingKeyboardTransition()
        return nil
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
