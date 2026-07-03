import UIKit

extension SessionTranscriptCollectionRepresentable {
    func makeLayout() -> UICollectionViewLayout {
        SessionTranscriptCollectionLayout(rowSpacing: rowSpacing)
    }
}

private final class SessionTranscriptCollectionLayout: UICollectionViewCompositionalLayout {
    init(rowSpacing: CGFloat) {
        super.init { _, _ in
            Self.makeSection(rowSpacing: rowSpacing)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override func invalidationContext(
        forPreferredLayoutAttributes preferredAttributes: UICollectionViewLayoutAttributes,
        withOriginalAttributes originalAttributes: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutInvalidationContext {
        let context = super.invalidationContext(
            forPreferredLayoutAttributes: preferredAttributes,
            withOriginalAttributes: originalAttributes
        )
        guard let collectionView else { return context }
        guard !collectionView.isTracking &&
                !collectionView.isDragging &&
                !collectionView.isDecelerating else {
            return context
        }

        // The coordinator owns bottom preservation after self-sizing changes.
        // Disable the layout's implicit offset correction so both paths do not
        // move the transcript in the same layout pass.
        context.contentOffsetAdjustment = .zero
        return context
    }

    private static func makeSection(rowSpacing: CGFloat) -> NSCollectionLayoutSection {
        let itemSize = NSCollectionLayoutSize(
            widthDimension: .fractionalWidth(1),
            heightDimension: .estimated(120)
        )
        let item = NSCollectionLayoutItem(layoutSize: itemSize)
        let group = NSCollectionLayoutGroup.vertical(
            layoutSize: itemSize,
            repeatingSubitem: item,
            count: 1
        )
        let section = NSCollectionLayoutSection(group: group)
        section.interGroupSpacing = rowSpacing
        return section
    }
}

/*
// Previous FlowLayout experiment. Kept commented out because it can suppress
// FlowLayout's automatic contentOffset adjustment, but its self-sizing passes
// have been glitchier than the compositional layout path above.
extension SessionTranscriptCollectionRepresentable {
    func makeLayout() -> UICollectionViewLayout {
        let layout = SessionTranscriptCollectionLayout()
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
        // The cell returns the measured height from preferredLayoutAttributesFitting.
        // Do not use .automaticSize here: FlowLayout passes this estimate into
        // preferredLayoutAttributesFitting, so the estimate must carry the final
        // row width even though the height is only a rough starting point.
        estimatedItemSize = CGSize(width: max(collectionView.bounds.width, 1), height: 120)
    }

    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
        // Scrolling changes bounds.origin. Only viewport size changes require
        // new row widths and fresh self-sizing measurements.
        collectionView?.bounds.size != newBounds.size
    }

    override func invalidationContext(
        forPreferredLayoutAttributes preferredAttributes: UICollectionViewLayoutAttributes,
        withOriginalAttributes originalAttributes: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutInvalidationContext {
        let context = super.invalidationContext(
            forPreferredLayoutAttributes: preferredAttributes,
            withOriginalAttributes: originalAttributes
        )
        guard let collectionView else { return context }
        guard !collectionView.isTracking &&
                !collectionView.isDragging &&
                !collectionView.isDecelerating else {
            return context
        }

        // The coordinator owns bottom preservation after self-sizing changes.
        // Disable FlowLayout's implicit offset correction so both paths do not
        // move the transcript in the same layout pass.
        context.contentOffsetAdjustment = .zero
        return context
    }
}
*/
