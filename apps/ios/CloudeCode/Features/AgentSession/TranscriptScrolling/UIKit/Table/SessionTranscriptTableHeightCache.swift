import Domain
import UIKit

extension SessionTranscriptTableRepresentable.Coordinator {
    func recordRowHeight(
        for cell: UITableViewCell,
        at indexPath: IndexPath,
        in tableView: UITableView
    ) {
        resetRowHeightCacheIfNeeded(for: tableView.bounds.width)
        guard let itemID = itemID(at: indexPath) else { return }

        let measuredHeight = cell.frame.height
        logRowHeightReconciliation(itemID: itemID, measuredHeight: measuredHeight)
        rowHeightCache[itemID] = measuredHeight
    }

    func estimatedRowHeight(at indexPath: IndexPath, in tableView: UITableView) -> CGFloat {
        guard rowHeightCacheWidth == tableView.bounds.width,
              let itemID = itemID(at: indexPath),
              let cachedHeight = rowHeightCache[itemID] else {
            // Unmeasured rows defer to UIKit's own estimation, which adapts to
            // the heights it has already measured.
            if let itemID = itemID(at: indexPath) {
                servedEstimatesByItemID[itemID] = UITableView.automaticDimension
            }
            return UITableView.automaticDimension
        }

        servedEstimatesByItemID[itemID] = cachedHeight
        return cachedHeight
    }

    func invalidateRowHeights(forItemIDs ids: [String]) {
        ids.forEach {
            rowHeightCache[$0] = nil
        }
    }

    func pruneRowHeightCache(keepingItemIDs ids: [String]) {
        let itemIDs = Set(ids)
        rowHeightCache = rowHeightCache.filter {
            itemIDs.contains($0.key)
        }
    }

    private func resetRowHeightCacheIfNeeded(for width: CGFloat) {
        // todo encode things like the width, accessibility font size,
        // in each cache key.
        guard rowHeightCacheWidth != width else { return }

        if let previousWidth = rowHeightCacheWidth, !rowHeightCache.isEmpty {
            Logger.debug(
                "row height cache reset",
                "width \(previousWidth) -> \(width)",
                "dropped \(rowHeightCache.count) entries"
            )
        }
        rowHeightCache.removeAll()
        rowHeightCacheWidth = width
    }

    // Diagnostic: one line per row display comparing the estimate UIKit was
    // given against the height it actually measured.
    private func logRowHeightReconciliation(itemID: String, measuredHeight: CGFloat) {
        let servedEstimate = servedEstimatesByItemID.removeValue(forKey: itemID)
        let estimateDescription: String
        let deltaDescription: String
        switch servedEstimate {
        case .none:
            estimateDescription = "none"
            deltaDescription = "n/a"
        case UITableView.automaticDimension:
            estimateDescription = "automatic"
            deltaDescription = "n/a"
        case .some(let estimate):
            estimateDescription = String(format: "%.1f", estimate)
            deltaDescription = String(format: "%+.1f", measuredHeight - estimate)
        }

        Logger.debug(
            "row height reconcile",
            "id=\(itemID)",
            "estimate=\(estimateDescription)",
            "measured=\(String(format: "%.1f", measuredHeight))",
            "delta=\(deltaDescription)",
            "cached=\(rowHeightCache.count)"
        )
    }
}
