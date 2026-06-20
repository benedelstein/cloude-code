import UIKit

extension SessionTranscriptCollectionRepresentable {
    func makeLayout() -> UICollectionViewLayout {
        UICollectionViewCompositionalLayout { _, _ in
            // Rows are SwiftUI-hosted and self-sizing. This estimate only seeds the
            // first layout pass; UIKit replaces it with measured heights as cells render.
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
