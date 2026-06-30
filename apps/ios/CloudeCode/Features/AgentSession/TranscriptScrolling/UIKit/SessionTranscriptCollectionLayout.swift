import Domain
import UIKit

extension SessionTranscriptCollectionRepresentable {
    func makeLayout() -> UICollectionViewLayout {
        let layout = SessionTranscriptCollectionLayout()
        layout.estimatedItemSize = UICollectionViewFlowLayout.automaticSize
        layout.itemSize = UICollectionViewFlowLayout.automaticSize
        layout.minimumLineSpacing = rowSpacing
        layout.minimumInteritemSpacing = 0
        layout.sectionInset = .zero
        return layout
    }
}

private final class SessionTranscriptCollectionLayout: UICollectionViewFlowLayout {
    override func prepare() {
        super.prepare()

        guard let collectionView else { return }

        scrollDirection = .vertical
        // Self-sizing hosted cells need to be measured at the final row width.
        // A full-width estimate avoids a width/height feedback loop where the
        // layout first measures narrow cells and then corrects both dimensions
        // in later invalidation passes.
        estimatedItemSize = CGSize(width: max(collectionView.bounds.width, 1), height: 55)
    }

    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
        // Scrolling changes bounds.origin. Only viewport size changes require
        // new row widths and fresh self-sizing measurements.
        collectionView?.bounds.size != newBounds.size
    }

//    override func invalidationContext(
//        forPreferredLayoutAttributes preferredAttributes: UICollectionViewLayoutAttributes,
//        withOriginalAttributes originalAttributes: UICollectionViewLayoutAttributes
//    ) -> UICollectionViewLayoutInvalidationContext {
//        let context = super.invalidationContext(
//            forPreferredLayoutAttributes: preferredAttributes,
//            withOriginalAttributes: originalAttributes
//        )
//        guard let collectionView, shouldCancelSelfSizingOffsetAdjustment(in: collectionView) else {
//            return context
//        }
//
//        // FlowLayout normally tries to preserve visual position when a
//        // self-sizing cell reports a new height. Transcript bottom-following is
//        // owned by the coordinator, so non-interactive self-sizing passes should
//        // not also apply UIKit's implicit contentOffset adjustment.
//        context.contentOffsetAdjustment = .zero
//        Logger.debug(
//            "transcript layout cancelled self-sizing offset adjustment",
//            "indexPath=\(preferredAttributes.indexPath)",
//            "originalHeight=\(format(originalAttributes.frame.height))",
//            "preferredHeight=\(format(preferredAttributes.frame.height))",
//            "distance=\(format(distanceFromBottom(in: collectionView)))"
//        )
//        return context
//    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        // TESTME: DO WE NEED THE FULL WIDTH ADJUSTMENT?
        super.layoutAttributesForElements(in: rect)?.map(fullWidthAttributes)
    }

    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        super.layoutAttributesForItem(at: indexPath).map(fullWidthAttributes)
    }

    private func fullWidthAttributes(
        _ attributes: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutAttributes {
        guard let collectionView else { return attributes }
        attributes.frame.origin.x = 0
        // force full width to avoid layout crash.
        attributes.frame.size.width = collectionView.bounds.width
        return attributes
    }

    private func shouldCancelSelfSizingOffsetAdjustment(in collectionView: UICollectionView) -> Bool {
        if isBottomAdjacentInteractiveDrag(in: collectionView) {
            return true
        }

        // During direct user scrolling, let UIKit keep the content under the
        // finger/momentum stable. Outside user interaction, the coordinator
        // decides whether and how to move the scroll position.
        guard !collectionView.isTracking &&
                !collectionView.isDragging &&
                !collectionView.isDecelerating else {
            return false
        }

        return true
    }

    private func isBottomAdjacentInteractiveDrag(in collectionView: UICollectionView) -> Bool {
        guard collectionView.keyboardDismissMode == .interactive else { return false }
        guard collectionView.isTracking || collectionView.isDragging else { return false }

        // Keyboard dismissal from the transcript bottom also reports as a tracked
        // scroll gesture. Keep FlowLayout from adding a second offset adjustment
        // while the keyboard-driven viewport change is being handled elsewhere.
        return distanceFromBottom(in: collectionView) <= SessionTranscriptScrollMetrics.bottomProximityThreshold
    }

    private func distanceFromBottom(in scrollView: UIScrollView) -> CGFloat {
        let visibleBottomY = scrollView.contentOffset.y
            + scrollView.bounds.height
            - scrollView.adjustedContentInset.bottom

        return scrollView.contentSize.height - visibleBottomY
    }

    private func format(_ value: CGFloat) -> String {
        String(format: "%.2f", Double(value))
    }
}
