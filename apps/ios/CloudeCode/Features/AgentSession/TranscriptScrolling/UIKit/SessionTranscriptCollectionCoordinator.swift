import SwiftUI
import Domain
import UIKit

// swiftlint:disable file_length

extension SessionTranscriptCollectionRepresentable {
    final class Coordinator: NSObject, UICollectionViewDelegate {
        private enum Section {
            case main
        }

        private typealias DataSource = UICollectionViewDiffableDataSource<Section, String>
        private typealias CellRegistration = UICollectionView.CellRegistration<SessionTranscriptCollectionCell, String>

        private var dataSource: DataSource?
        private var itemsByID: [String: SessionTranscriptItem] = [:]
        private(set) var initialAnchorState: SessionTranscriptInitialAnchorState = .waitingForItems
        private var lastItems: [SessionTranscriptItem] = []
        private var lastItemIDs: [String] = []
        private var lastLayoutBoundsSize: CGSize?
        private var lastLayoutContentSize: CGSize?
        private var lastDistanceFromBottom: CGFloat?
        private var contentInsetConfiguration = SessionTranscriptContentInsetConfiguration()
        private var workingIndicatorLayoutFrameBeforeUpdate: CGRect?
        private var isUserScrolling = false
        var isFollowingBottom = true
        var handledScrollRequestID = 0
        let scrollCoordinator: SessionTranscriptScrollCoordinator
        private var rowContent: (SessionTranscriptItem) -> Row

        init(
            scrollCoordinator: SessionTranscriptScrollCoordinator,
            rowContent: @escaping (SessionTranscriptItem) -> Row
        ) {
            self.scrollCoordinator = scrollCoordinator
            self.rowContent = rowContent
        }

        func installDataSource(on collectionView: UICollectionView) {
            let registration = CellRegistration { [weak self] cell, _, id in
                guard let self, let item = itemsByID[id] else {
                    cell.contentConfiguration = nil
                    return
                }

                configure(cell, with: item)
            }

            dataSource = DataSource(collectionView: collectionView) { collectionView, indexPath, id in
                collectionView.dequeueConfiguredReusableCell(
                    using: registration,
                    for: indexPath,
                    item: id
                )
            }
        }

        func installScrollDelegate(on collectionView: UICollectionView) {
            collectionView.delegate = self
        }

        func configure(_ cell: UICollectionViewCell, with item: SessionTranscriptItem) {
            let rowContent = self.rowContent
            cell.contentConfiguration = UIHostingConfiguration {
                rowContent(item)
            }
            .margins(.all, 0)
        }

        func indexPath(forItemID id: String) -> IndexPath? {
            dataSource?.indexPath(for: id)
        }

        func collectionView(
            _ collectionView: UICollectionView,
            willDisplay cell: UICollectionViewCell,
            forItemAt indexPath: IndexPath
        ) {
            Logger.debug("will display cell at \(indexPath) - \(cell.bounds.size)")
            // optimization - possibly cache heights here.
        }

        func update(
            collectionView: UICollectionView,
            items: [SessionTranscriptItem],
            keyboardDismissPadding: CGFloat,
            contentPadding: CGFloat,
            rowContent: @escaping (SessionTranscriptItem) -> Row
        ) {
            self.rowContent = rowContent
            let nextContentInsetConfiguration = SessionTranscriptContentInsetConfiguration(
                contentPadding: contentPadding,
                bottomOverlayHeight: keyboardDismissPadding
            )
            let didChangeContentInsetConfiguration = nextContentInsetConfiguration != contentInsetConfiguration
            contentInsetConfiguration = nextContentInsetConfiguration
            itemsByID = items.reduce(into: [:]) {
                $0[$1.id] = $1
            }
            prepareWorkingIndicatorLayoutTransition(collectionView)

            updateKeyboardDismissPadding(keyboardDismissPadding, in: collectionView)
            if didChangeContentInsetConfiguration {
                collectionView.setNeedsLayout()
            }

            let itemIDs = items.map(\.id)
            let isInitialLoad = isWaitingForInitialItems && !itemIDs.isEmpty

            if itemIDs == lastItemIDs {
                let changedItemIDs = changedItemIDs(
                    oldItems: lastItems,
                    newItems: items
                )
                guard !changedItemIDs.isEmpty else {
                    lastItems = items
                    return
                }

                lastItems = items
                updateVisibleItems(changedItemIDs, in: collectionView)
                return
            }

            applyNewItemIDs(
                items,
                itemIDs,
                to: collectionView,
                isInitialLoad: isInitialLoad
            )
        }

        func handleLayoutSubviews(_ collectionView: UICollectionView) {
            let keyboardTransition = SessionTranscriptKeyboardAnimation.activeTransition(in: collectionView)
            let wasNearBottomBeforeLayout = lastDistanceFromBottom.map {
                $0 <= SessionTranscriptScrollMetrics.bottomProximityThreshold
            } ?? isNearBottom(collectionView)
            if wasNearBottomBeforeLayout && !isUserScrolling {
                isFollowingBottom = true
            }
            let didUpdateContentInsets = updateContentInsets(collectionView)
            let layoutChange = SessionTranscriptLayoutChange(
                boundsChanged: lastLayoutBoundsSize != collectionView.bounds.size,
                contentSizeChanged: lastLayoutContentSize != collectionView.contentSize,
                didUpdateContentInsets: didUpdateContentInsets
            )
            defer {
                recordLayoutState(collectionView)
            }

            if isFollowingBottom && !wasNearBottomBeforeLayout {
                Logger.debug("bottom tracking lost? \(lastDistanceFromBottom, default: "no last dist")")
            }

            // Keep the visible bottom pinned after UIKit realizes geometry changes.
            // The layout-change type decides whether that correction may animate.
            if !isUserScrolling && (isFollowingBottom || wasNearBottomBeforeLayout) {
//                preserveBottomAfterLayout(
//                    collectionView,
//                    shouldPreserveBottom: isFollowingBottom || wasNearBottomBeforeLayout,
//                    layoutChange: layoutChange,
//                    keyboardTransition: keyboardTransition
//                )
            }
            animateWorkingIndicatorLayoutTransition(
                in: collectionView,
                layoutChange: layoutChange,
                keyboardTransition: keyboardTransition
            )

            // During initial load, SwiftUI-hosted cells may self-size across multiple
            // layout passes. Stay hidden until the measured geometry is stable and
            // the content offset is actually at the bottom.
            guard case let .anchoring(lastGeometry, attempts) = initialAnchorState else {
                return
            }

            guard collectionView.bounds.height > 0 else { return }
            guard collectionView.contentSize.height > 0 else { return }

            continueInitialBottomAnchor(
                collectionView,
                lastGeometry: lastGeometry,
                attempts: attempts
            )
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            if scrollView.isTracking || scrollView.isDragging {
                isUserScrolling = true
            }

//            if isUserScrolling {
//                updateFollowingBottomFromUserScroll(scrollView)
//            }
            updateScrollToBottomVisibility(scrollView)
        }

        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            isUserScrolling = true
            isFollowingBottom = false
            scrollCoordinator.finishScrollToBottom()
            updateScrollToBottomVisibility(scrollView)
        }

        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            guard !decelerate else { return }

            updateFollowingBottomFromUserScroll(scrollView)
            isUserScrolling = false
            updateScrollToBottomVisibility(scrollView)
        }

        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
            updateFollowingBottomFromUserScroll(scrollView)
            isUserScrolling = false
            updateScrollToBottomVisibility(scrollView)
        }

        func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
            let didRetargetBottom = continueFollowingBottomAfterProgrammaticScroll(scrollView)
            if !didRetargetBottom {
                scrollCoordinator.finishScrollToBottom()
            }
            updateScrollToBottomVisibility(scrollView)
        }
    }
}

extension SessionTranscriptCollectionRepresentable.Coordinator {
    var isWaitingForInitialItems: Bool {
        if case .waitingForItems = initialAnchorState {
            return true
        }

        return false
    }

    var isInitialAnchorComplete: Bool {
        if case .complete = initialAnchorState {
            return true
        }

        return false
    }

    var maximumInitialAnchorLayoutAttempts: Int {
        8
    }

    private func recordLayoutState(_ collectionView: UICollectionView) {
        guard collectionView.bounds.height > 0 else { return }
        guard collectionView.contentSize.height > 0 else { return }

        lastLayoutBoundsSize = collectionView.bounds.size
        lastLayoutContentSize = collectionView.contentSize
        lastDistanceFromBottom = distanceFromBottom(collectionView)
        updateScrollToBottomVisibility(collectionView)
    }

    func updateContentInsets(_ collectionView: UICollectionView) -> Bool {
        let contentInset = contentInset(in: collectionView)
        guard collectionView.contentInset != contentInset else { return false }

        applyContentInset(contentInset, to: collectionView)
        return true
    }

    /// Sets the point at which drag down gesture starts dismissing the keyboard, to the top of the composer.
    private func updateKeyboardDismissPadding(_ padding: CGFloat, in collectionView: UICollectionView) {
        guard collectionView.keyboardLayoutGuide.keyboardDismissPadding != padding else { return }

        collectionView.keyboardLayoutGuide.keyboardDismissPadding = padding
    }

    func contentInset(in collectionView: UICollectionView) -> UIEdgeInsets {
        let obstructionInsets = (collectionView as? LayoutReportingCollectionView)?
            .contentInsets() ?? collectionView.safeAreaInsets
        return UIEdgeInsets(
            top: roundedForScreen(
                contentInsetConfiguration.contentPadding + obstructionInsets.top,
                in: collectionView
            ),
            left: 0,
            bottom: roundedForScreen(
                contentInsetConfiguration.contentPadding
                    + contentInsetConfiguration.bottomOverlayHeight
                    + obstructionInsets.bottom,
                in: collectionView
            ),
            right: 0
        )
    }

    func applyContentInset(_ contentInset: UIEdgeInsets, to collectionView: UICollectionView) {
        collectionView.contentInset = contentInset
        collectionView.verticalScrollIndicatorInsets = contentInset
    }

    func prepareWorkingIndicatorLayoutTransition(_ collectionView: UICollectionView) {
        guard isInitialAnchorComplete else {
            workingIndicatorLayoutFrameBeforeUpdate = nil
            return
        }

        guard !collectionView.isTracking && !collectionView.isDragging && !collectionView.isDecelerating else {
            workingIndicatorLayoutFrameBeforeUpdate = nil
            return
        }

        let frame = layoutFrame(
            forItemID: SessionTranscriptItem.workingItemID,
            in: collectionView
        )
        workingIndicatorLayoutFrameBeforeUpdate = frame
        if let frame {
            Logger.debug(
                "captured working indicator layout frame",
                workingIndicatorGeometryDescription(frame: frame, in: collectionView)
            )
        }
    }

    func animateWorkingIndicatorLayoutTransition(
        in collectionView: UICollectionView,
        layoutChange: SessionTranscriptLayoutChange,
        keyboardTransition: KeyboardTransition?
    ) {
        defer {
            workingIndicatorLayoutFrameBeforeUpdate = nil
        }

        guard layoutChange.contentSizeChanged else { return }
        guard keyboardTransition == nil else { return }
        guard let previousFrame = workingIndicatorLayoutFrameBeforeUpdate else { return }
        guard let cell = cell(forItemID: SessionTranscriptItem.workingItemID, in: collectionView) else { return }

        let currentFrame = cell.frame
        let deltaX = previousFrame.minX - currentFrame.minX
        let deltaY = previousFrame.minY - currentFrame.minY
        guard abs(deltaX) > 0.5 || abs(deltaY) > 0.5 else { return }
        if let skipReason = workingIndicatorAnimationSkipReason(
            from: previousFrame,
            to: currentFrame,
            in: collectionView
        ) {
            Logger.debug(
                "skipping working indicator layout animation",
                "reason=\(skipReason)",
                workingIndicatorMoveDescription(
                    from: previousFrame,
                    to: currentFrame,
                    in: collectionView
                )
            )
            return
        }

        Logger.debug(
            "moving working indicator",
            workingIndicatorMoveDescription(
                from: previousFrame,
                to: currentFrame,
                in: collectionView
            )
        )
        animateWorkingIndicatorCell(cell, translationX: deltaX, translationY: deltaY)
    }

    func animateWorkingIndicatorCell(
        _ cell: UICollectionViewCell,
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
        in collectionView: UICollectionView
    ) -> String? {
        let deltaX = previousFrame.minX - currentFrame.minX
        let deltaY = previousFrame.minY - currentFrame.minY
        let maximumHorizontalDelta = collectionView.bounds.width / 2
        let maximumVerticalDelta = min(max(collectionView.bounds.height * 0.35, 80), 220)

        guard abs(deltaX) <= maximumHorizontalDelta, abs(deltaY) <= maximumVerticalDelta else {
            return "delta exceeds limit"
        }

        let animationBounds = collectionView.bounds.insetBy(dx: 0, dy: -maximumVerticalDelta)
        guard previousFrame.intersects(animationBounds) || currentFrame.intersects(animationBounds) else {
            return "frames outside visible animation bounds"
        }

        return nil
    }

    func workingIndicatorMoveDescription(
        from previousFrame: CGRect,
        to currentFrame: CGRect,
        in collectionView: UICollectionView
    ) -> String {
        let delta = CGPoint(
            x: previousFrame.minX - currentFrame.minX,
            y: previousFrame.minY - currentFrame.minY
        )
        return [
            "from=\(format(previousFrame))",
            "to=\(format(currentFrame))",
            "delta=(x:\(format(delta.x)), y:\(format(delta.y)))",
            workingIndicatorGeometryDescription(frame: currentFrame, in: collectionView)
        ].joined(separator: " ")
    }

    func workingIndicatorGeometryDescription(
        frame: CGRect,
        in collectionView: UICollectionView
    ) -> String {
        [
            "frame=\(format(frame))",
            "visible=\(format(collectionView.bounds))",
            "offsetY=\(format(collectionView.contentOffset.y))",
            "contentHeight=\(format(collectionView.contentSize.height))",
            "boundsHeight=\(format(collectionView.bounds.height))",
            "isVisible=\(frame.intersects(collectionView.bounds))"
        ].joined(separator: " ")
    }

    func layoutFrame(forItemID id: String, in collectionView: UICollectionView) -> CGRect? {
        guard let cell = cell(forItemID: id, in: collectionView) else { return nil }

        return cell.frame
    }

    func cell(forItemID id: String, in collectionView: UICollectionView) -> UICollectionViewCell? {
        guard let indexPath = indexPath(forItemID: id) else { return nil }

        return collectionView.cellForItem(at: indexPath)
    }

    func roundedForScreen(_ value: CGFloat, in view: UIView) -> CGFloat {
        let scale = view.window?.screen.scale ?? UIScreen.main.scale
        return (value * scale).rounded() / scale
    }

    func preserveBottomAfterLayout(
        _ collectionView: UICollectionView,
        shouldPreserveBottom: Bool,
        layoutChange: SessionTranscriptLayoutChange,
        keyboardTransition: KeyboardTransition?
    ) {
        guard isInitialAnchorComplete
            && shouldPreserveBottom
            && layoutChange.didChangeLayout else {
            return
        }

        isFollowingBottom = true
        let shouldAnimate = layoutChange.shouldAnimateBottomPreservation(keyboardTransition: keyboardTransition)
        Logger.debug(
            "transcript preserving bottom",
            "animated=\(shouldAnimate)",
            "distance=\(String(format: "%.2f", Double(distanceFromBottom(collectionView))))",
            "contentSizeChanged=\(layoutChange.contentSizeChanged)",
            "boundsChanged=\(layoutChange.boundsChanged)",
            "insetsChanged=\(layoutChange.didUpdateContentInsets)"
        )
        scrollToBottom(
            collectionView,
            animated: shouldAnimate,
            keyboardTransition: keyboardTransition
        )
    }

    private func continueInitialBottomAnchor(
        _ collectionView: UICollectionView,
        lastGeometry: SessionTranscriptInitialAnchorGeometry?,
        attempts: Int
    ) {
        let nextAttempts = attempts + 1

        if nextAttempts > maximumInitialAnchorLayoutAttempts {
            scrollToBottom(collectionView, animated: false)
            completeInitialBottomAnchor(collectionView)
            return
        }

        let geometry = SessionTranscriptInitialAnchorGeometry(
            boundsSize: collectionView.bounds.size,
            contentSize: collectionView.contentSize
        )

        guard geometry == lastGeometry else {
            correctInitialBottomAnchor(
                collectionView,
                geometry: geometry,
                attempts: nextAttempts,
                reason: "geometry changed"
            )
            return
        }

        guard isAtBottom(collectionView) else {
            correctInitialBottomAnchor(
                collectionView,
                geometry: geometry,
                attempts: nextAttempts,
                reason: "offset is not bottom"
            )
            return
        }

        completeInitialBottomAnchor(collectionView)
    }

    private func correctInitialBottomAnchor(
        _ collectionView: UICollectionView,
        geometry: SessionTranscriptInitialAnchorGeometry,
        attempts: Int,
        reason: String
    ) {
        initialAnchorState = .anchoring(
            lastGeometry: geometry,
            attempts: attempts
        )
        scrollToBottom(collectionView, animated: false)
        collectionView.setNeedsLayout()
    }

    func applyNewItemIDs(
        _ items: [SessionTranscriptItem],
        _ itemIDs: [String],
        to collectionView: UICollectionView,
        isInitialLoad: Bool
    ) {
        let changedExistingItemIDs = changedExistingItemIDs(
            oldItems: lastItems,
            newItems: items
        )
        lastItems = items
        lastItemIDs = itemIDs

        // new snapshot from scratch
        var snapshot = NSDiffableDataSourceSnapshot<Section, String>()
        snapshot.appendSections([.main])
        snapshot.appendItems(itemIDs, toSection: .main)

        if isInitialLoad {
            applyInitialSnapshot(snapshot, to: collectionView, itemCount: itemIDs.count)
            return
        }

        dataSource?.apply(snapshot, animatingDifferences: false) { [weak self, weak collectionView] in
            guard let self, let collectionView else { return }

            updateVisibleItems(changedExistingItemIDs, in: collectionView)
        }
    }

    private func applyInitialSnapshot(
        _ snapshot: NSDiffableDataSourceSnapshot<Section, String>,
        to collectionView: UICollectionView,
        itemCount: Int
    ) {
        initialAnchorState = .applyingSnapshot
        collectionView.alpha = 0

        // Initial load is a full replacement from empty data, so reloadData avoids a
        // diff pass. The collection view stays hidden until layout has settled below.
        dataSource?.applySnapshotUsingReloadData(snapshot) { [weak self, weak collectionView] in
            guard let self, let collectionView else { return }

            initialAnchorState = .anchoring(lastGeometry: nil, attempts: 0)
            collectionView.setNeedsLayout()
        }
    }

    func updateVisibleItems(_ itemIDs: [String], in collectionView: UICollectionView) {
        guard let dataSource else { return }

        let existingIDs = Set(dataSource.snapshot().itemIdentifiers)
        let updatedIDs = itemIDs.filter { existingIDs.contains($0) }
        guard !updatedIDs.isEmpty else { return }
        updateVisibleCellsWithoutAnimation(updatedIDs, in: collectionView)
    }

    func updateVisibleCellsWithoutAnimation(
        _ itemIDs: [String],
        in collectionView: UICollectionView
    ) {
        UIView.performWithoutAnimation {
            guard var snapshot = dataSource?.snapshot() else { return }
            snapshot.reconfigureItems(itemIDs)
            dataSource?.apply(snapshot, animatingDifferences: false)
//            collectionView.reconfigureItems(at: indexPaths)
//            for id in itemIDs {
//                guard let item = itemsByID[id], let cell = cell(forItemID: id, in: collectionView) else { continue }
//
//                configure(cell, with: item)
//                let indexPath = indexPath(forItemID: id)
//                collectionView.reconfigureItems(at: indexPath)
//                cell.setNeedsLayout()
//                cell.layoutIfNeeded()
//            }
        }
        collectionView.layer.removeAllAnimations()
    }

    func logApplyGeometry(
        _ event: String,
        collectionView: UICollectionView,
        changedItemIDs: [String]
    ) {
        Logger.debug(
            "transcript diffable",
            event,
            "changed=\(changedItemIDs.joined(separator: ","))",
            "offsetY=\(format(collectionView.contentOffset.y))",
            "contentHeight=\(format(collectionView.contentSize.height))",
            "boundsHeight=\(format(collectionView.bounds.height))",
            "bottomInset=\(format(collectionView.adjustedContentInset.bottom))",
            "distanceFromBottom=\(format(distanceFromBottom(collectionView)))",
            "isTracking=\(collectionView.isTracking)",
            "isDragging=\(collectionView.isDragging)",
            "isDecelerating=\(collectionView.isDecelerating)"
        )
    }

    func logApplyGeometryOnNextTick(
        _ event: String,
        collectionView: UICollectionView,
        changedItemIDs: [String]
    ) {
        DispatchQueue.main.async { [weak self, weak collectionView] in
            guard let self, let collectionView else { return }

            logApplyGeometry(
                event,
                collectionView: collectionView,
                changedItemIDs: changedItemIDs
            )
        }
    }

    func changedItemIDs(
        oldItems: [SessionTranscriptItem],
        newItems: [SessionTranscriptItem]
    ) -> [String] {
        zip(oldItems, newItems).compactMap { oldItem, newItem in
            oldItem == newItem ? nil : newItem.id
        }
    }

    func changedExistingItemIDs(
        oldItems: [SessionTranscriptItem],
        newItems: [SessionTranscriptItem]
    ) -> [String] {
        let oldItemsByID = Dictionary(uniqueKeysWithValues: oldItems.map { ($0.id, $0) })
        return newItems.compactMap { newItem in
            guard let oldItem = oldItemsByID[newItem.id], oldItem != newItem else {
                return nil
            }

            return newItem.id
        }
    }

    private func format(_ value: CGFloat) -> String {
        String(format: "%.2f", Double(value))
    }

    private func format(_ rect: CGRect) -> String {
        [
            "x:\(format(rect.minX))",
            "y:\(format(rect.minY))",
            "w:\(format(rect.width))",
            "h:\(format(rect.height))"
        ].joined(separator: " ")
    }

    func completeInitialBottomAnchor(_ collectionView: UICollectionView) {
        initialAnchorState = .complete
        collectionView.alpha = 1
        collectionView.layer.removeAllAnimations()
    }
}
