import UIKit

extension SessionTranscriptCollectionRepresentable {
    func makeLayout() -> UICollectionViewLayout {
        UICollectionViewCompositionalLayout { _, _ in
            // Rows are SwiftUI-hosted and self-sizing. This estimate only seeds the
            // first layout pass; UIKit replaces it with measured heights as cells render.
            // FUTURE OPTIMIZATION: calculate cell heights using the text layout and possibly cache them
            // and give each swiftui cell a fixed .frame(height: ..) modifier so each dequeued cell can
            // size fixed and not waste time recalculating the dynamic height.
            let itemSize = NSCollectionLayoutSize(
                widthDimension: .fractionalWidth(1),
                heightDimension: .estimated(44)
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
}
