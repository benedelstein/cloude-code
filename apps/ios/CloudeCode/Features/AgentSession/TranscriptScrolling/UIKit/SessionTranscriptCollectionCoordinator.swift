import SwiftUI
import UIKit

extension SessionTranscriptCollectionRepresentable {
    final class Coordinator: NSObject, UICollectionViewDelegate {
        private enum Section {
            case main
        }

        private typealias DataSource = UICollectionViewDiffableDataSource<Section, String>
        private typealias CellRegistration = UICollectionView.CellRegistration<UICollectionViewCell, String>

        private var dataSource: DataSource?
        private var itemsByID: [String: SessionTranscriptItem] = [:]
        private(set) var initialAnchorState: SessionTranscriptInitialAnchorState = .waitingForItems
        private var lastItems: [SessionTranscriptItem] = []
        private var lastItemIDs: [String] = []
        private var lastLayoutBoundsSize: CGSize?
        private var lastLayoutContentSize: CGSize?
        private var lastDistanceFromBottom: CGFloat?
        private var contentInsetConfiguration = SessionTranscriptContentInsetConfiguration()
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

                let rowContent = self.rowContent
                cell.contentConfiguration = UIHostingConfiguration {
                    rowContent(item)
                }
                .margins(.all, 0)
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

        func indexPath(forItemID id: String) -> IndexPath? {
            dataSource?.indexPath(for: id)
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
            itemsByID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })

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
                reconfigureItems(changedItemIDs, in: collectionView)
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
            let keyboardTransition = activeKeyboardTransition(in: collectionView)
            let wasNearBottomBeforeLayout = lastDistanceFromBottom.map {
                $0 <= SessionTranscriptScrollMetrics.bottomProximityThreshold
            } ?? isNearBottom(collectionView)
            let layoutChange = SessionTranscriptLayoutChange(
                boundsChanged: lastLayoutBoundsSize != collectionView.bounds.size,
                contentSizeChanged: lastLayoutContentSize != collectionView.contentSize,
                didUpdateContentInsets: updateContentInsets(collectionView)
            )
            defer {
                recordLayoutState(collectionView)
            }

            // Keep the visible bottom pinned after UIKit realizes geometry changes.
            // The layout-change type decides whether that correction may animate.
            preserveBottomAfterLayout(
                collectionView,
                wasNearBottomBeforeLayout: wasNearBottomBeforeLayout,
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
            updateScrollToBottomVisibility(scrollView)
        }

        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            scrollCoordinator.finishScrollToBottom()
            updateScrollToBottomVisibility(scrollView)
        }

        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            guard !decelerate else { return }

            updateScrollToBottomVisibility(scrollView)
        }

        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
            updateScrollToBottomVisibility(scrollView)
        }

        func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
            scrollCoordinator.finishScrollToBottom()
            updateScrollToBottomVisibility(scrollView)
        }
    }
}

private extension SessionTranscriptCollectionRepresentable.Coordinator {
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

    func activeKeyboardTransition(in collectionView: UICollectionView) -> KeyboardTransition? {
        let layoutCollectionView = collectionView as? LayoutReportingCollectionView
        return activeKeyboardTransition(
            layoutCollectionView?.pendingKeyboardTransition,
            in: layoutCollectionView
        )
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

    func roundedForScreen(_ value: CGFloat, in view: UIView) -> CGFloat {
        let scale = view.window?.screen.scale ?? UIScreen.main.scale
        return (value * scale).rounded() / scale
    }

    func preserveBottomAfterLayout(
        _ collectionView: UICollectionView,
        wasNearBottomBeforeLayout: Bool,
        layoutChange: SessionTranscriptLayoutChange,
        keyboardTransition: KeyboardTransition?
    ) {
        guard isInitialAnchorComplete
            && wasNearBottomBeforeLayout
            && layoutChange.didChangeLayout else {
            return
        }

        scrollToBottom(
            collectionView,
            animated: layoutChange.shouldAnimateBottomPreservation(keyboardTransition: keyboardTransition),
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
        lastItems = items
        lastItemIDs = itemIDs

        var snapshot = NSDiffableDataSourceSnapshot<Section, String>()
        snapshot.appendSections([.main])
        snapshot.appendItems(itemIDs, toSection: .main)

        if isInitialLoad {
            applyInitialSnapshot(snapshot, to: collectionView, itemCount: itemIDs.count)
            return
        }

        dataSource?.apply(snapshot, animatingDifferences: false)
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

    func reconfigureItems(_ itemIDs: [String], in collectionView: UICollectionView) {
        guard let dataSource else { return }

        let existingIDs = Set(dataSource.snapshot().itemIdentifiers)
        let reconfiguredIDs = itemIDs.filter { existingIDs.contains($0) }
        guard !reconfiguredIDs.isEmpty else { return }

        var snapshot = dataSource.snapshot()
        snapshot.reconfigureItems(reconfiguredIDs)
        dataSource.apply(snapshot, animatingDifferences: false)
    }

    func changedItemIDs(
        oldItems: [SessionTranscriptItem],
        newItems: [SessionTranscriptItem]
    ) -> [String] {
        zip(oldItems, newItems).compactMap { oldItem, newItem in
            oldItem == newItem ? nil : newItem.id
        }
    }

    func completeInitialBottomAnchor(_ collectionView: UICollectionView) {
        initialAnchorState = .complete
        collectionView.alpha = 1
        collectionView.layer.removeAllAnimations()
    }
}
