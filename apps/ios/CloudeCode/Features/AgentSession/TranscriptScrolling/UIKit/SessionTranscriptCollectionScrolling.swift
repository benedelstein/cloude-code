import UIKit

extension SessionTranscriptCollectionRepresentable.Coordinator {
    func handleScrollToBottomRequestIfNeeded(
        _ scrollToBottomRequestID: Int,
        in collectionView: UICollectionView
    ) {
        guard scrollToBottomRequestID != handledScrollToBottomRequestID else { return }

        handledScrollToBottomRequestID = scrollToBottomRequestID
        let targetOffset = bottomContentOffset(in: collectionView)

        guard abs(collectionView.contentOffset.y - targetOffset.y)
            > SessionTranscriptScrollMetrics.bottomDistanceEpsilon else {
            scrollCoordinator.finishScrollToBottom()
            updateScrollToBottomVisibility(collectionView)
            return
        }

        scrollToBottom(collectionView, animated: true)
    }

    func scrollToBottom(
        _ collectionView: UICollectionView,
        animated: Bool,
        keyboardTransition: KeyboardTransition? = nil
    ) {
        let targetOffset = bottomContentOffset(in: collectionView)
        guard abs(collectionView.contentOffset.y - targetOffset.y)
            > SessionTranscriptScrollMetrics.bottomDistanceEpsilon else {
            updateScrollToBottomVisibility(collectionView)
            return
        }

        let applyOffset = {
            if keyboardTransition != nil {
                collectionView.contentOffset = targetOffset
            } else {
                collectionView.setContentOffset(targetOffset, animated: animated)
            }
            collectionView.layoutIfNeeded()
        }

        if let keyboardTransition {
            animateWithKeyboardTransition(keyboardTransition, applyOffset)
        } else if animated {
            applyOffset()
        } else {
            UIView.performWithoutAnimation {
                applyOffset()
            }
            collectionView.layer.removeAllAnimations()
        }
    }

    func bottomContentOffset(in collectionView: UICollectionView) -> CGPoint {
        // UIKit's maximum vertical offset is content height minus visible height,
        // plus the adjusted bottom inset. Clamp to the top inset for short content.
        let yOffset = max(
            -collectionView.adjustedContentInset.top,
            collectionView.contentSize.height
                - collectionView.bounds.height
                + collectionView.adjustedContentInset.bottom
        )

        return CGPoint(x: collectionView.contentOffset.x, y: yOffset)
    }

    func isAtBottom(_ collectionView: UICollectionView) -> Bool {
        abs(distanceFromBottom(collectionView)) <= SessionTranscriptScrollMetrics.bottomDistanceEpsilon
    }

    func isNearBottom(_ collectionView: UICollectionView) -> Bool {
        distanceFromBottom(collectionView) <= SessionTranscriptScrollMetrics.bottomProximityThreshold
    }

    func distanceFromBottom(_ scrollView: UIScrollView) -> CGFloat {
        let visibleBottomY = scrollView.contentOffset.y
            + scrollView.bounds.height
            - scrollView.adjustedContentInset.bottom

        return scrollView.contentSize.height - visibleBottomY
    }

    func updateScrollToBottomVisibility(_ scrollView: UIScrollView) {
        guard case .complete = initialAnchorState else { return }

        scrollCoordinator.updateDistanceFromBottom(distanceFromBottom(scrollView))
    }
}
