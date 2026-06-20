import UIKit

extension SessionTranscriptCollectionRepresentable.Coordinator {
    func unexpiredKeyboardTransition(
        _ transition: LayoutReportingCollectionView.KeyboardTransition?,
        in collectionView: LayoutReportingCollectionView?,
        didChangeLayout: Bool
    ) -> LayoutReportingCollectionView.KeyboardTransition? {
        guard let transition else { return nil }
        guard !didChangeLayout && transition.remainingDuration <= 0 else {
            return transition
        }

        print("xx clearing expired keyboard transition remainingDuration=\(transition.remainingDuration)")
        collectionView?.clearPendingKeyboardTransition()
        return nil
    }

    func clearKeyboardTransitionIfNeeded(
        _ collectionView: LayoutReportingCollectionView?,
        _ transition: LayoutReportingCollectionView.KeyboardTransition?,
        _ didChangeLayout: Bool
    ) {
        guard transition != nil && didChangeLayout else { return }

        print("xx clearing consumed keyboard transition")
        collectionView?.clearPendingKeyboardTransition()
    }

    func animateWithKeyboardTransition(
        _ keyboardTransition: LayoutReportingCollectionView.KeyboardTransition,
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
