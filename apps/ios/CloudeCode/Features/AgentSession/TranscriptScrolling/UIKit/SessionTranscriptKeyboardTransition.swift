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

        collectionView?.clearPendingKeyboardTransition()
    }
}
