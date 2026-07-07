import Domain
import UIKit

extension SessionTranscriptTableRepresentable.Coordinator {
    func prepareWorkingIndicatorLayoutTransition(_ tableView: UITableView) {
        guard isInitialAnchorComplete else {
            workingIndicatorLayoutFrameBeforeUpdate = nil
            return
        }

        guard !tableView.isTracking && !tableView.isDragging && !tableView.isDecelerating else {
            workingIndicatorLayoutFrameBeforeUpdate = nil
            return
        }

        workingIndicatorLayoutFrameBeforeUpdate = layoutFrame(
            forItemID: SessionTranscriptItem.workingItemID,
            in: tableView
        )
    }

    func animateWorkingIndicatorLayoutTransition(
        in tableView: UITableView,
        layoutChange: SessionTranscriptLayoutChange,
        keyboardTransition: KeyboardTransition?
    ) {
        defer {
            workingIndicatorLayoutFrameBeforeUpdate = nil
        }

        guard layoutChange.contentSizeChanged else { return }
        guard keyboardTransition == nil else { return }
        guard let previousFrame = workingIndicatorLayoutFrameBeforeUpdate else { return }
        guard let cell = cell(forItemID: SessionTranscriptItem.workingItemID, in: tableView) else { return }

        let currentFrame = cell.frame
        let deltaX = previousFrame.minX - currentFrame.minX
        let deltaY = previousFrame.minY - currentFrame.minY
        guard abs(deltaX) > 0.5 || abs(deltaY) > 0.5 else { return }
        guard workingIndicatorAnimationSkipReason(
            from: previousFrame,
            to: currentFrame,
            in: tableView
        ) == nil else {
            return
        }

        animateWorkingIndicatorCell(cell, translationX: deltaX, translationY: deltaY)
    }

    /// FLIP transition (First, Last, Invert, Play): the cell's frame was
    /// captured before the update (First) and compared to its post-layout frame
    /// (Last); here the delta transform places it back at the old position
    /// (Invert) and animates to identity (Play), so the indicator visibly
    /// slides to its new spot instead of teleporting.
    func animateWorkingIndicatorCell(
        _ cell: UITableViewCell,
        translationX: CGFloat,
        translationY: CGFloat
    ) {
        cell.layer.removeAllAnimations()
        cell.transform = CGAffineTransform(translationX: translationX, y: translationY)
        UIView.animate(
            withDuration: 0.22,
            delay: 0,
            options: [.allowUserInteraction, .beginFromCurrentState, .curveEaseOut]
        ) {
            cell.transform = .identity
        }
    }

    func workingIndicatorAnimationSkipReason(
        from previousFrame: CGRect,
        to currentFrame: CGRect,
        in tableView: UITableView
    ) -> String? {
        let deltaX = previousFrame.minX - currentFrame.minX
        let deltaY = previousFrame.minY - currentFrame.minY
        let maximumHorizontalDelta = tableView.bounds.width / 2
        let maximumVerticalDelta = min(max(tableView.bounds.height * 0.35, 80), 220)

        guard abs(deltaX) <= maximumHorizontalDelta, abs(deltaY) <= maximumVerticalDelta else {
            return "delta exceeds limit"
        }

        let animationBounds = tableView.bounds.insetBy(dx: 0, dy: -maximumVerticalDelta)
        guard previousFrame.intersects(animationBounds) || currentFrame.intersects(animationBounds) else {
            return "frames outside visible animation bounds"
        }

        return nil
    }

    func cell(forItemID id: String, in tableView: UITableView) -> UITableViewCell? {
        guard let indexPath = indexPath(forItemID: id) else { return nil }

        return tableView.cellForRow(at: indexPath)
    }

    func layoutFrame(forItemID id: String, in tableView: UITableView) -> CGRect? {
        guard let cell = cell(forItemID: id, in: tableView) else { return nil }

        return cell.frame
    }
}
