import UIKit
import SwiftUI

struct SessionTranscriptCollectionRepresentable<Row: View>: UIViewRepresentable {
    let items: [SessionTranscriptItem]
    let keyboardDismissPadding: CGFloat
    let rowSpacing: CGFloat
    let contentPadding: CGFloat
    let scrollCoordinator: SessionTranscriptScrollCoordinator
    let scrollToBottomRequestID: Int
    let rowContent: (SessionTranscriptItem) -> Row

    func makeCoordinator() -> Coordinator {
        Coordinator(
            scrollCoordinator: scrollCoordinator,
            rowContent: rowContent
        )
    }

    func makeUIView(context: Context) -> LayoutReportingCollectionView {
        let collectionView = LayoutReportingCollectionView(
            frame: .zero,
            collectionViewLayout: makeLayout()
        )

        collectionView.backgroundColor = .clear
        collectionView.clipsToBounds = false
        collectionView.layer.masksToBounds = false
        collectionView.alwaysBounceVertical = true
        collectionView.keyboardDismissMode = .interactive
        collectionView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 26.0, *) {
            collectionView.topEdgeEffect.style = .soft
            collectionView.bottomEdgeEffect.style = .soft
        }
        collectionView.onLayoutSubviews = { [weak coordinator = context.coordinator] collectionView in
            coordinator?.handleLayoutSubviews(collectionView)
        }

        context.coordinator.installDataSource(on: collectionView)
        context.coordinator.installScrollDelegate(on: collectionView)
        return collectionView
    }

    func updateUIView(_ collectionView: LayoutReportingCollectionView, context: Context) {
        context.coordinator.update(
            collectionView: collectionView,
            items: items,
            keyboardDismissPadding: keyboardDismissPadding,
            contentPadding: contentPadding,
            rowContent: rowContent
        )
        context.coordinator.handleScrollToBottomRequestIfNeeded(
            scrollToBottomRequestID,
            in: collectionView
        )
    }
}

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
        private var lastDistanceFromBottom: CGFloat?
        private var contentInsetConfiguration = SessionTranscriptContentInsetConfiguration()
        var handledScrollToBottomRequestID = 0
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
                cell.backgroundColor = .clear
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
            let shouldPreserveBottomAnchor = nextContentInsetConfiguration != contentInsetConfiguration
                && isInitialAnchorComplete
                && isAtBottom(collectionView)
            contentInsetConfiguration = nextContentInsetConfiguration
            itemsByID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })

            if collectionView.keyboardLayoutGuide.keyboardDismissPadding != keyboardDismissPadding {
                collectionView.keyboardLayoutGuide.keyboardDismissPadding = keyboardDismissPadding
            }

            let didUpdateContentInsets = updateContentInsets(collectionView, reason: "update")
            if didUpdateContentInsets && shouldPreserveBottomAnchor {
                scrollToBottom(collectionView, animated: false)
            }

            let itemIDs = items.map(\.id)
            let isInitialLoad = isWaitingForInitialItems && !itemIDs.isEmpty

            if itemIDs == lastItemIDs {
                guard items != lastItems else { return }

                print("xx reconfiguring \(itemIDs.count) transcript items")
                lastItems = items
                reconfigureItems(itemIDs)
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
            let layoutCollectionView = collectionView as? LayoutReportingCollectionView
            var keyboardTransition = layoutCollectionView?.pendingKeyboardTransition
            let wasAtBottomBeforeLayout = lastDistanceFromBottom.map { abs($0) <= 0.5 }
                ?? isAtBottom(collectionView)
            let boundsChanged = lastLayoutBoundsSize != collectionView.bounds.size
            let didUpdateContentInsets = updateContentInsets(collectionView, reason: "layout")
            let didChangeLayout = boundsChanged || didUpdateContentInsets
            defer {
                recordLayoutState(collectionView)
            }

            keyboardTransition = unexpiredKeyboardTransition(
                keyboardTransition,
                in: layoutCollectionView,
                didChangeLayout: didChangeLayout
            )

            if keyboardTransition != nil {
                logKeyboardLayout(collectionView, wasAtBottomBeforeLayout, boundsChanged, didUpdateContentInsets)
            }

            if isInitialAnchorComplete
                && wasAtBottomBeforeLayout
                && didChangeLayout {
                scrollToBottom(
                    collectionView,
                    animated: false,
                    keyboardTransition: keyboardTransition
                )
            }

            clearKeyboardTransitionIfNeeded(layoutCollectionView, keyboardTransition, didChangeLayout)

            // During initial load, SwiftUI-hosted cells may self-size across multiple
            // layout passes. Stay hidden until the measured geometry is stable and
            // the content offset is actually at the bottom.
            guard case let .anchoring(lastGeometry, attempts) = initialAnchorState else {
                return
            }

            logInitialAnchorLayout(collectionView, attempts: attempts)

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

    func recordLayoutState(_ collectionView: UICollectionView) {
        guard collectionView.bounds.height > 0 else { return }
        guard collectionView.contentSize.height > 0 else { return }

        lastLayoutBoundsSize = collectionView.bounds.size
        lastDistanceFromBottom = distanceFromBottom(collectionView)
        updateScrollToBottomVisibility(collectionView)
    }

    func updateContentInsets(_ collectionView: UICollectionView, reason: String) -> Bool {
        let obstructionInsets = (collectionView as? LayoutReportingCollectionView)?
            .contentInsets() ?? collectionView.safeAreaInsets
        let contentInset = UIEdgeInsets(
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

        guard collectionView.contentInset != contentInset else { return false }

        collectionView.contentInset = contentInset
        collectionView.verticalScrollIndicatorInsets = contentInset
        print(
                "xx transcript contentInset updated reason=\(reason) " +
                "inset=\(contentInset) " +
                "topObstructionHeight=\(obstructionInsets.top) " +
                "bottomObstructionHeight=\(obstructionInsets.bottom) " +
                "bottomOverlayHeight=\(contentInsetConfiguration.bottomOverlayHeight)"
        )
        return true
    }

    func roundedForScreen(_ value: CGFloat, in view: UIView) -> CGFloat {
        let scale = view.window?.screen.scale ?? UIScreen.main.scale
        return (value * scale).rounded() / scale
    }

    func logInitialAnchorLayout(_ collectionView: UICollectionView, attempts: Int) {
        print(
            "xx layoutSubviews for pending initial anchor; " +
                "attempt=\(attempts) " +
                "bounds=\(collectionView.bounds.size) " +
                "contentSize=\(collectionView.contentSize) " +
                "offset=\(collectionView.contentOffset) " +
                "bottomDistance=\(distanceFromBottom(collectionView))"
        )
    }

    func logKeyboardLayout(
        _ collectionView: UICollectionView,
        _ wasAtBottomBeforeLayout: Bool,
        _ boundsChanged: Bool,
        _ didUpdateContentInsets: Bool
    ) {
        print(
            "xx keyboard layout transition; " +
                "wasAtBottomBeforeLayout=\(wasAtBottomBeforeLayout) " +
                "lastDistanceFromBottom=\(String(describing: lastDistanceFromBottom)) " +
                "boundsChanged=\(boundsChanged) " +
                "didUpdateContentInsets=\(didUpdateContentInsets) " +
                "bounds=\(collectionView.bounds.size) " +
                "contentSize=\(collectionView.contentSize) " +
                "offset=\(collectionView.contentOffset)"
        )
    }

    private func continueInitialBottomAnchor(
        _ collectionView: UICollectionView,
        lastGeometry: SessionTranscriptInitialAnchorGeometry?,
        attempts: Int
    ) {
        let nextAttempts = attempts + 1

        if nextAttempts > maximumInitialAnchorLayoutAttempts {
            print("xx initial anchor reached attempt limit; revealing current state")
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
        print("xx initial layout \(reason); correcting bottom offset while hidden")
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

        print("xx applying snapshot for \(itemIDs.count) transcript items, initial=false")
        dataSource?.apply(snapshot, animatingDifferences: false) { [weak collectionView] in
            guard let collectionView else { return }

            print(
                "xx snapshot applied; bounds=\(collectionView.bounds.size) " +
                    "contentSize=\(collectionView.contentSize) " +
                    "offset=\(collectionView.contentOffset)"
            )
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
        print("xx applying initial snapshot using reloadData for \(itemCount) transcript items")
        dataSource?.applySnapshotUsingReloadData(snapshot) { [weak self, weak collectionView] in
            guard let self, let collectionView else { return }

            initialAnchorState = .anchoring(lastGeometry: nil, attempts: 0)
            print(
                "xx initial snapshot applied; bounds=\(collectionView.bounds.size) " +
                    "contentSize=\(collectionView.contentSize) " +
                    "offset=\(collectionView.contentOffset)"
            )
            collectionView.setNeedsLayout()
        }
    }

    func reconfigureItems(_ itemIDs: [String]) {
        guard let dataSource else { return }

        let existingIDs = Set(dataSource.snapshot().itemIdentifiers)
        let reconfiguredIDs = itemIDs.filter { existingIDs.contains($0) }
        guard !reconfiguredIDs.isEmpty else { return }

        var snapshot = dataSource.snapshot()
        snapshot.reconfigureItems(reconfiguredIDs)
        dataSource.apply(snapshot, animatingDifferences: false)
    }

    func completeInitialBottomAnchor(_ collectionView: UICollectionView) {
        print(
            "xx completing initial bottom anchor; bounds=\(collectionView.bounds.size) " +
                "contentSize=\(collectionView.contentSize) " +
                "offset=\(collectionView.contentOffset) " +
                "bottomDistance=\(distanceFromBottom(collectionView))"
        )
        initialAnchorState = .complete
        UIView.performWithoutAnimation {
            collectionView.alpha = 1
        }
        collectionView.layer.removeAllAnimations()
    }
}
