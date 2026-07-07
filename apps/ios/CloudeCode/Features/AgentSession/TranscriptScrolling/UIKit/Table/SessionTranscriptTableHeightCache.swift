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

        rowHeightCache[itemID] = cell.frame.height
    }

    func estimatedRowHeight(at indexPath: IndexPath, in tableView: UITableView) -> CGFloat {
        guard rowHeightCacheWidth == tableView.bounds.width,
              let itemID = itemID(at: indexPath),
              let cachedHeight = rowHeightCache[itemID] else {
            // Unmeasured rows defer to UIKit's own estimation, which adapts to
            // the heights it has already measured.
            return UITableView.automaticDimension
        }

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

        rowHeightCache.removeAll()
        rowHeightCacheWidth = width
    }
}
