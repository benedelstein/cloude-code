import Domain
import UIKit

extension SessionTranscriptTableRepresentable.Coordinator {
    func handleScrollRequestIfNeeded(
        _ scrollRequest: SessionTranscriptScrollRequest?,
        in tableView: UITableView
    ) {
        guard let scrollRequest else { return }
        guard scrollRequest.id != handledScrollRequestID else { return }

        handledScrollRequestID = scrollRequest.id

        switch scrollRequest.destination {
        case .top:
            isFollowingBottom = false
            scrollToTop(tableView, animated: scrollRequest.animated)
        case .bottom:
            handleScrollToBottomRequest(scrollRequest, in: tableView)
        case .message(let id):
            isFollowingBottom = false
            scrollToItem(
                id: SessionTranscriptItem.messageItemID(for: id),
                alignment: scrollRequest.alignment,
                animated: scrollRequest.animated,
                in: tableView
            )
        case .item(let id):
            isFollowingBottom = false
            scrollToItem(
                id: id,
                alignment: scrollRequest.alignment,
                animated: scrollRequest.animated,
                in: tableView
            )
        }
    }

    func handleScrollToBottomRequest(
        _ scrollRequest: SessionTranscriptScrollRequest,
        in tableView: UITableView
    ) {
        let targetOffset = bottomContentOffset(in: tableView)

        guard abs(tableView.contentOffset.y - targetOffset.y)
            > SessionTranscriptScrollMetrics.bottomDistanceEpsilon else {
            isFollowingBottom = true
            scrollCoordinator.finishScrollToBottom()
            updateScrollToBottomVisibility(tableView)
            return
        }

        isFollowingBottom = true
        scrollToBottom(tableView, animated: scrollRequest.animated)
        if !scrollRequest.animated {
            scrollCoordinator.finishScrollToBottom()
        }
    }

    func scrollToTop(_ tableView: UITableView, animated: Bool) {
        let targetOffset = CGPoint(
            x: tableView.contentOffset.x,
            y: -tableView.adjustedContentInset.top
        )

        applyContentOffset(targetOffset, in: tableView, animated: animated)
    }

    func scrollToItem(
        id: String,
        alignment: SessionTranscriptScrollAlignment,
        animated: Bool,
        in tableView: UITableView
    ) {
        guard let indexPath = indexPath(forItemID: id) else {
            updateScrollToBottomVisibility(tableView)
            return
        }

        let scrollPosition: UITableView.ScrollPosition
        switch alignment {
        case .top:
            scrollPosition = .top
        case .center:
            scrollPosition = .middle
        case .bottom:
            scrollPosition = .bottom
        }

        if animated {
            isAnimatingProgrammaticScroll = true
        }

        tableView.scrollToRow(
            at: indexPath,
            at: scrollPosition,
            animated: animated
        )

        if !animated {
            tableView.layoutIfNeeded()
            updateScrollToBottomVisibility(tableView)
        }
    }

    func scrollToBottom(
        _ tableView: UITableView,
        animated: Bool,
        keyboardTransition: KeyboardTransition? = nil
    ) {
        let targetOffset = bottomContentOffset(in: tableView)
        guard abs(tableView.contentOffset.y - targetOffset.y)
            > SessionTranscriptScrollMetrics.bottomDistanceEpsilon else {
            updateScrollToBottomVisibility(tableView)
            return
        }

        let applyOffset = {
            if keyboardTransition != nil {
                tableView.contentOffset = targetOffset
            } else {
                self.applyContentOffset(targetOffset, in: tableView, animated: animated)
            }
            tableView.layoutIfNeeded()
        }

        if tableView.isInteractivelyDismissingKeyboard {
            UIView.performWithoutAnimation(applyOffset)
            tableView.layer.removeAllAnimations()
        } else if let keyboardTransition {
            SessionTranscriptKeyboardAnimation.animate(with: keyboardTransition, applyOffset)
        } else if animated {
            applyOffset()
        } else {
            UIView.performWithoutAnimation {
                applyOffset()
            }
            tableView.layer.removeAllAnimations()
        }
    }

    func preserveBottomAfterLayout(
        _ tableView: UITableView,
        layoutChange: SessionTranscriptLayoutChange,
        keyboardTransition: KeyboardTransition?
    ) {
        guard isInitialAnchorComplete && layoutChange.didChangeLayout else { return }
        guard !isAtBottom(tableView) else { return }

        if layoutChange.shouldAnimateBottomPreservation(keyboardTransition: keyboardTransition) {
            // An in-flight follow animation retargets the newest bottom from
            // scrollViewDidEndScrollingAnimation; starting another would restart it.
            guard !isAnimatingProgrammaticScroll else { return }
            scrollToBottom(tableView, animated: true)
        } else {
            scrollToBottom(tableView, animated: false, keyboardTransition: keyboardTransition)
        }
    }

    func applyContentOffset(
        _ targetOffset: CGPoint,
        in tableView: UITableView,
        animated: Bool
    ) {
        guard abs(tableView.contentOffset.y - targetOffset.y)
            > SessionTranscriptScrollMetrics.bottomDistanceEpsilon else {
            updateScrollToBottomVisibility(tableView)
            return
        }

        if animated {
            isAnimatingProgrammaticScroll = true
            tableView.setContentOffset(targetOffset, animated: true)
        } else {
            isAnimatingProgrammaticScroll = false
            UIView.performWithoutAnimation {
                tableView.setContentOffset(targetOffset, animated: false)
                tableView.layoutIfNeeded()
            }
            tableView.layer.removeAllAnimations()
            updateScrollToBottomVisibility(tableView)
        }
    }

    func bottomContentOffset(in tableView: UITableView) -> CGPoint {
        // UIKit's maximum vertical offset is content height minus visible height,
        // plus adjusted bottom inset. Clamp to the top inset for short content.
        let yOffset = max(
            -tableView.adjustedContentInset.top,
            tableView.contentSize.height
                - tableView.bounds.height
                + tableView.adjustedContentInset.bottom
        )

        return CGPoint(x: tableView.contentOffset.x, y: yOffset)
    }

    func isAtBottom(_ tableView: UITableView) -> Bool {
        abs(distanceFromBottom(tableView)) <= SessionTranscriptScrollMetrics.bottomDistanceEpsilon
    }

    func isNearBottom(_ tableView: UITableView) -> Bool {
        distanceFromBottom(tableView) <= SessionTranscriptScrollMetrics.bottomProximityThreshold
    }

    func distanceFromBottom(_ scrollView: UIScrollView) -> CGFloat {
        let visibleBottomY = scrollView.contentOffset.y
            + scrollView.bounds.height
            - scrollView.adjustedContentInset.bottom

        return scrollView.contentSize.height - visibleBottomY
    }

    func updateScrollToBottomVisibility(_ scrollView: UIScrollView) {
        guard case .complete = initialAnchorState else { return }

        if isFollowingBottom {
            scrollCoordinator.updateDistanceFromBottom(0)
            return
        }

        let distance = distanceFromBottom(scrollView)
        scrollCoordinator.updateDistanceFromBottom(distance)
    }

    func updateFollowingBottomFromUserScroll(_ scrollView: UIScrollView) {
        isFollowingBottom = distanceFromBottom(scrollView) <= SessionTranscriptScrollMetrics.bottomProximityThreshold
    }

    func continueFollowingBottomAfterProgrammaticScroll(_ scrollView: UIScrollView) -> Bool {
        guard isFollowingBottom, let tableView = scrollView as? UITableView else { return false }
        guard !isAtBottom(tableView) else { return false }

        // Streaming can grow content while an animated scroll is in flight. Retarget
        // the newest bottom instead of treating the stale endpoint as user intent.
        scrollToBottom(tableView, animated: true)
        return true
    }
}
