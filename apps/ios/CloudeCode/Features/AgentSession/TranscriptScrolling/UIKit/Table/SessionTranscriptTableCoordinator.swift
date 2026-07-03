import Domain
import SwiftUI
import UIKit

private let tableCellReuseID = "SessionTranscriptTableCell"
let tableEstimatedRowHeight: CGFloat = 120

extension SessionTranscriptTableRepresentable {
    final class Coordinator: NSObject, UITableViewDelegate {
        typealias ContentInsetConfiguration = SessionTranscriptContentInsetConfiguration

        private enum Section {
            case main
        }

        private typealias DataSource = UITableViewDiffableDataSource<Section, String>

        private var dataSource: DataSource?
        private var itemsByID: [String: SessionTranscriptItem] = [:]
        private(set) var initialAnchorState: SessionTranscriptInitialAnchorState = .waitingForItems
        private var lastItems: [SessionTranscriptItem] = []
        private var lastItemIDs: [String] = []
        private var lastLayoutBoundsSize: CGSize?
        private var lastLayoutContentSize: CGSize?
        private var lastDistanceFromBottom: CGFloat?
        private var contentInsetConfiguration = ContentInsetConfiguration()
        private var isUserScrolling = false
        var isFollowingBottom = true
        var isAnimatingProgrammaticScroll = false
        var handledScrollRequestID = 0
        let scrollCoordinator: SessionTranscriptScrollCoordinator
        private var rowContent: (SessionTranscriptItem) -> Row
        private let rowSpacing: CGFloat

        init(
            scrollCoordinator: SessionTranscriptScrollCoordinator,
            rowSpacing: CGFloat,
            rowContent: @escaping (SessionTranscriptItem) -> Row
        ) {
            self.scrollCoordinator = scrollCoordinator
            self.rowSpacing = rowSpacing
            self.rowContent = rowContent
        }

        func installDataSource(on tableView: UITableView) {
            tableView.register(
                SessionTranscriptTableCell.self,
                forCellReuseIdentifier: tableCellReuseID
            )
            dataSource = DataSource(tableView: tableView) { [weak self] tableView, indexPath, id in
                let cell = tableView.dequeueReusableCell(
                    withIdentifier: tableCellReuseID,
                    for: indexPath
                )
                guard let transcriptCell = cell as? SessionTranscriptTableCell else {
                    return cell
                }

                guard let self, let item = itemsByID[id] else {
                    transcriptCell.contentConfiguration = nil
                    return transcriptCell
                }

                self.configure(transcriptCell, with: item)
                return transcriptCell
            }
        }

        func installScrollDelegate(on tableView: UITableView) {
            tableView.delegate = self
        }

        func configure(_ cell: UITableViewCell, with item: SessionTranscriptItem) {
            let rowContent = self.rowContent
            // UITableView has no inter-row spacing knob for plain hosted cells, so
            // spacing lives inside every hosted row except the final transcript row.
            let rowSpacing = item.id == lastItemIDs.last ? 0 : rowSpacing
            cell.contentConfiguration = UIHostingConfiguration {
                rowContent(item)
                    .padding(.bottom, rowSpacing)
            }
            .margins(.all, 0)
        }

        func indexPath(forItemID id: String) -> IndexPath? {
            dataSource?.indexPath(for: id)
        }

        /// Update tableview state from swiftui changes
        func update(
            tableView: UITableView,
            items: [SessionTranscriptItem],
            keyboardDismissPadding: CGFloat,
            contentPadding: CGFloat,
            rowContent: @escaping (SessionTranscriptItem) -> Row
        ) {
            self.rowContent = rowContent
//            tableView.estimatedRowHeight = tableEstimatedRowHeight

            let nextContentInsetConfiguration = SessionTranscriptContentInsetConfiguration(
                contentPadding: contentPadding,
                bottomOverlayHeight: keyboardDismissPadding
            )
            let didChangeContentInsetConfiguration = nextContentInsetConfiguration != contentInsetConfiguration
            contentInsetConfiguration = nextContentInsetConfiguration
            itemsByID = items.reduce(into: [:]) {
                $0[$1.id] = $1
            }

            updateKeyboardDismissPadding(keyboardDismissPadding, in: tableView)
            if didChangeContentInsetConfiguration {
                tableView.setNeedsLayout()
            }

            let itemIDs = items.map(\.id)
            let isInitialLoad = isWaitingForInitialItems && !itemIDs.isEmpty

            if itemIDs == lastItemIDs {
                // Streaming usually mutates stable rows. Reconfigure those cells
                // instead of applying a structural diff and inviting row animation.
                let changedItemIDs = changedItemIDs(
                    oldItems: lastItems,
                    newItems: items
                )
                guard !changedItemIDs.isEmpty else {
                    lastItems = items
                    return
                }

                lastItems = items
                updateVisibleItems(changedItemIDs, in: tableView)
                return
            }

            applyNewItemIDs(
                items,
                itemIDs,
                to: tableView,
                isInitialLoad: isInitialLoad
            )
        }

        func handleLayoutSubviews(_ tableView: UITableView) {
            let keyboardTransition = SessionTranscriptKeyboardAnimation.activeTransition(in: tableView)
            let wasNearBottomBeforeLayout = lastDistanceFromBottom.map {
                $0 <= SessionTranscriptScrollMetrics.bottomProximityThreshold
            } ?? isNearBottom(tableView)
            if wasNearBottomBeforeLayout && !isUserScrolling {
                isFollowingBottom = true
            }
            let didUpdateContentInsets = updateContentInsets(tableView)
            let layoutChange = SessionTranscriptLayoutChange(
                boundsChanged: lastLayoutBoundsSize != tableView.bounds.size,
                contentSizeChanged: lastLayoutContentSize != tableView.contentSize,
                didUpdateContentInsets: didUpdateContentInsets
            )
            defer {
                recordLayoutState(tableView)
            }

            if isAnimatingProgrammaticScroll && isAtBottom(tableView) {
                isAnimatingProgrammaticScroll = false
            }

            preserveBottomIfFollowing(
                tableView,
                layoutChange: layoutChange,
                keyboardTransition: keyboardTransition
            )

            // The initial transcript stays hidden until automatic row heights settle
            // and the table has really landed at the bottom.
            guard case let .anchoring(lastGeometry, attempts) = initialAnchorState else {
                return
            }

            guard tableView.bounds.height > 0 else { return }
            guard tableView.contentSize.height > 0 else { return }

            continueInitialBottomAnchor(
                tableView,
                lastGeometry: lastGeometry,
                attempts: attempts
            )
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            if scrollView.isTracking || scrollView.isDragging {
                isUserScrolling = true
            }

            updateScrollToBottomVisibility(scrollView)
        }

        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            isAnimatingProgrammaticScroll = false
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
            isAnimatingProgrammaticScroll = false
            let didRetargetBottom = continueFollowingBottomAfterProgrammaticScroll(scrollView)
            if !didRetargetBottom {
                scrollCoordinator.finishScrollToBottom()
            }
            updateScrollToBottomVisibility(scrollView)
        }

        // future optimization - cache cell heights and retrun from cache instead of estimate.
//        func tableView(_ tableView: UITableView, estimatedHeightForRowAt indexPath: IndexPath) -> CGFloat {
//            // Keep the delegate hook in place so table-view estimate experiments
//            // stay localized here; start with one explicit baseline estimate.
//            tableEstimatedRowHeight
//        }
    }
}

extension SessionTranscriptTableRepresentable.Coordinator {
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

    private func recordLayoutState(_ tableView: UITableView) {
        guard tableView.bounds.height > 0 else { return }
        guard tableView.contentSize.height > 0 else { return }

        lastLayoutBoundsSize = tableView.bounds.size
        lastLayoutContentSize = tableView.contentSize
        lastDistanceFromBottom = distanceFromBottom(tableView)
        updateScrollToBottomVisibility(tableView)
    }

    func updateContentInsets(_ tableView: UITableView) -> Bool {
        let contentInset = contentInset(in: tableView)
        guard tableView.contentInset != contentInset else { return false }

        applyContentInset(contentInset, to: tableView)
        return true
    }

    private func updateKeyboardDismissPadding(_ padding: CGFloat, in tableView: UITableView) {
        guard tableView.keyboardLayoutGuide.keyboardDismissPadding != padding else { return }

        tableView.keyboardLayoutGuide.keyboardDismissPadding = padding
    }

    func contentInset(in tableView: UITableView) -> UIEdgeInsets {
        let obstructionInsets = (tableView as? LayoutReportingTableView)?
            .contentInsets() ?? tableView.safeAreaInsets
        return UIEdgeInsets(
            top: roundedForScreen(
                contentInsetConfiguration.contentPadding + obstructionInsets.top,
                in: tableView
            ),
            left: 0,
            bottom: roundedForScreen(
                // Bottom inset includes the composer overlay, safe area, and row
                // padding so the final row can sit above the input surface.
                contentInsetConfiguration.contentPadding
                    + contentInsetConfiguration.bottomOverlayHeight
                    + obstructionInsets.bottom,
                in: tableView
            ),
            right: 0
        )
    }

    func applyContentInset(_ contentInset: UIEdgeInsets, to tableView: UITableView) {
        tableView.contentInset = contentInset
        tableView.verticalScrollIndicatorInsets = contentInset
    }

    func roundedForScreen(_ value: CGFloat, in view: UIView) -> CGFloat {
        let scale = view.window?.screen.scale ?? UIScreen.main.scale
        return (value * scale).rounded() / scale
    }

    private func continueInitialBottomAnchor(
        _ tableView: UITableView,
        lastGeometry: SessionTranscriptInitialAnchorGeometry?,
        attempts: Int
    ) {
        let nextAttempts = attempts + 1

        if nextAttempts > maximumInitialAnchorLayoutAttempts {
            scrollToBottom(tableView, animated: false)
            completeInitialBottomAnchor(tableView)
            return
        }

        let geometry = SessionTranscriptInitialAnchorGeometry(
            boundsSize: tableView.bounds.size,
            contentSize: tableView.contentSize
        )

        guard geometry == lastGeometry else {
            correctInitialBottomAnchor(
                tableView,
                geometry: geometry,
                attempts: nextAttempts
            )
            return
        }

        guard isAtBottom(tableView) else {
            correctInitialBottomAnchor(
                tableView,
                geometry: geometry,
                attempts: nextAttempts
            )
            return
        }

        completeInitialBottomAnchor(tableView)
    }

    private func correctInitialBottomAnchor(
        _ tableView: UITableView,
        geometry: SessionTranscriptInitialAnchorGeometry,
        attempts: Int
    ) {
        initialAnchorState = .anchoring(
            lastGeometry: geometry,
            attempts: attempts
        )
        scrollToBottom(tableView, animated: false)
        tableView.setNeedsLayout()
    }

    func applyNewItemIDs(
        _ items: [SessionTranscriptItem],
        _ itemIDs: [String],
        to tableView: UITableView,
        isInitialLoad: Bool
    ) {
        let changedExistingItemIDs = changedExistingItemIDs(
            oldItems: lastItems,
            newItems: items
        )
        lastItems = items
        lastItemIDs = itemIDs

        var snapshot = NSDiffableDataSourceSnapshot<Section, String>()
        snapshot.appendSections([.main])
        snapshot.appendItems(itemIDs, toSection: .main)

        if isInitialLoad {
            applyInitialSnapshot(snapshot, to: tableView)
            return
        }

        // Rows that survive the structural diff with changed content reconfigure
        // in the same apply; the diff alone would treat their identical IDs as
        // unchanged and leave stale cells behind.
        snapshot.reconfigureItems(changedExistingItemIDs)
        UIView.performWithoutAnimation {
            dataSource?.apply(snapshot, animatingDifferences: false)
        }
        tableView.layer.removeAllAnimations()
    }

    private func applyInitialSnapshot(
        _ snapshot: NSDiffableDataSourceSnapshot<Section, String>,
        to tableView: UITableView
    ) {
        initialAnchorState = .applyingSnapshot
        // Avoid showing the table while automatic row heights are still resolving
        // from estimated values and before the first bottom anchor has completed.
        tableView.alpha = 0

        dataSource?.applySnapshotUsingReloadData(snapshot) { [weak self, weak tableView] in
            guard let self, let tableView else { return }

            initialAnchorState = .anchoring(lastGeometry: nil, attempts: 0)
            tableView.setNeedsLayout()
        }
    }

    func preserveBottomIfFollowing(
        _ tableView: UITableView,
        layoutChange: SessionTranscriptLayoutChange,
        keyboardTransition: KeyboardTransition?
    ) {
        guard !isUserScrolling && isFollowingBottom else { return }

        preserveBottomAfterLayout(
            tableView,
            layoutChange: layoutChange,
            keyboardTransition: keyboardTransition
        )
    }

    func updateVisibleItems(_ itemIDs: [String], in tableView: UITableView) {
        guard let dataSource else { return }

        let existingIDs = Set(dataSource.snapshot().itemIdentifiers)
        let updatedIDs = itemIDs.filter { existingIDs.contains($0) }
        guard !updatedIDs.isEmpty else { return }
        updateVisibleCellsWithoutAnimation(updatedIDs, in: tableView)
    }

    func updateVisibleCellsWithoutAnimation(
        _ itemIDs: [String],
        in tableView: UITableView
    ) {
        // Text streaming should update hosted cells in place; UIKit row animations
        // make the baseline harder to compare against the collection path.
        UIView.performWithoutAnimation {
            guard var snapshot = dataSource?.snapshot() else { return }
            snapshot.reconfigureItems(itemIDs)
            dataSource?.apply(snapshot, animatingDifferences: false)
        }
        tableView.layer.removeAllAnimations()
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

    func completeInitialBottomAnchor(_ tableView: UITableView) {
        initialAnchorState = .complete
        tableView.alpha = 1
        tableView.layer.removeAllAnimations()
    }
}
