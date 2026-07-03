import UIKit
import Domain

extension SessionTranscriptCollectionRepresentable.Coordinator {
    func handleScrollRequestIfNeeded(
        _ scrollRequest: SessionTranscriptScrollRequest?,
        in collectionView: UICollectionView
    ) {
        guard let scrollRequest else { return }
        guard scrollRequest.id != handledScrollRequestID else { return }

        handledScrollRequestID = scrollRequest.id

        switch scrollRequest.destination {
        case .top:
            isFollowingBottom = false
            scrollToTop(collectionView, animated: scrollRequest.animated)
        case .bottom:
            handleScrollToBottomRequest(scrollRequest, in: collectionView)
        case .message(let id):
            isFollowingBottom = false
            scrollToItem(
                id: SessionTranscriptItem.messageItemID(for: id),
                alignment: scrollRequest.alignment,
                animated: scrollRequest.animated,
                in: collectionView
            )
        case .item(let id):
            isFollowingBottom = false
            scrollToItem(
                id: id,
                alignment: scrollRequest.alignment,
                animated: scrollRequest.animated,
                in: collectionView
            )
        }
    }

    func handleScrollToBottomRequest(
        _ scrollRequest: SessionTranscriptScrollRequest,
        in collectionView: UICollectionView
    ) {
        let targetOffset = bottomContentOffset(in: collectionView)

        guard abs(collectionView.contentOffset.y - targetOffset.y)
            > SessionTranscriptScrollMetrics.bottomDistanceEpsilon else {
            isFollowingBottom = true
            scrollCoordinator.finishScrollToBottom()
            updateScrollToBottomVisibility(collectionView)
            return
        }

        isFollowingBottom = true
        scrollToBottom(collectionView, animated: scrollRequest.animated)
        if !scrollRequest.animated {
            scrollCoordinator.finishScrollToBottom()
        }
    }

    func scrollToTop(_ collectionView: UICollectionView, animated: Bool) {
        let targetOffset = CGPoint(
            x: collectionView.contentOffset.x,
            y: -collectionView.adjustedContentInset.top
        )

        applyContentOffset(targetOffset, in: collectionView, animated: animated)
    }

    func scrollToItem(
        id: String,
        alignment: SessionTranscriptScrollAlignment,
        animated: Bool,
        in collectionView: UICollectionView
    ) {
        guard let indexPath = indexPath(forItemID: id) else {
            updateScrollToBottomVisibility(collectionView)
            return
        }

        let scrollPosition: UICollectionView.ScrollPosition
        switch alignment {
        case .top:
            scrollPosition = .top
        case .center:
            scrollPosition = .centeredVertically
        case .bottom:
            scrollPosition = .bottom
        }

        collectionView.scrollToItem(
            at: indexPath,
            at: scrollPosition,
            animated: animated
        )

        if !animated {
            collectionView.layoutIfNeeded()
            updateScrollToBottomVisibility(collectionView)
        }
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
                self.applyContentOffset(targetOffset, in: collectionView, animated: animated)
            }
            collectionView.layoutIfNeeded()
        }

        Logger.debug("scrolling to bottom - animated: \(animated), keyboard: \(keyboardTransition != nil)")
        if collectionView.isInteractivelyDismissingKeyboard {
            UIView.performWithoutAnimation(applyOffset)
            collectionView.layer.removeAllAnimations()
        } else if let keyboardTransition {
            SessionTranscriptKeyboardAnimation.animate(with: keyboardTransition, applyOffset)
        } else if animated {
            applyOffset()
        } else {
            UIView.performWithoutAnimation {
                applyOffset()
            }
            collectionView.layer.removeAllAnimations()
        }
    }

    func applyContentOffset(
        _ targetOffset: CGPoint,
        in collectionView: UICollectionView,
        animated: Bool
    ) {
        guard abs(collectionView.contentOffset.y - targetOffset.y)
            > SessionTranscriptScrollMetrics.bottomDistanceEpsilon else {
            updateScrollToBottomVisibility(collectionView)
            return
        }

        if animated {
            collectionView.setContentOffset(targetOffset, animated: true)
        } else {
            UIView.performWithoutAnimation {
                collectionView.setContentOffset(targetOffset, animated: false)
                collectionView.layoutIfNeeded()
            }
            collectionView.layer.removeAllAnimations()
            updateScrollToBottomVisibility(collectionView)
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

        let distance = distanceFromBottom(scrollView)
        scrollCoordinator.updateDistanceFromBottom(distance)
    }

    func updateFollowingBottomFromUserScroll(_ scrollView: UIScrollView) {
        isFollowingBottom = distanceFromBottom(scrollView) <= SessionTranscriptScrollMetrics.bottomProximityThreshold
    }

    func continueFollowingBottomAfterProgrammaticScroll(_ scrollView: UIScrollView) -> Bool {
        guard isFollowingBottom, let collectionView = scrollView as? UICollectionView else { return false }
        guard !isAtBottom(collectionView) else { return false }

        // Streaming can grow content while an animated bottom-preservation scroll
        // is in flight. Keep following the newest bottom instead of treating the
        // stale animation endpoint as user scroll state.
        scrollToBottom(collectionView, animated: true)
        return true
    }
}
