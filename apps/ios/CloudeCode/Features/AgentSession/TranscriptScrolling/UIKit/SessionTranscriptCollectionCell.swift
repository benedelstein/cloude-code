import UIKit
import Domain

// Self-sizing for the compositional transcript layout (estimated item heights).
// The layout asks each cell for its preferred attributes; instead of trusting
// what super returns for the SwiftUI-hosted content (which can lag a content
// update), the cell re-measures the content view at the layout's row width and
// reports that height, rounded up to a whole point.
final class SessionTranscriptCollectionCell: UICollectionViewCell {
    override func preferredLayoutAttributesFitting(
        _ layoutAttributes: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutAttributes {
        layoutIfNeeded()
        let fittingAttributes = super.preferredLayoutAttributesFitting(layoutAttributes)
        let targetWidth = layoutAttributes.frame.width
        Logger.debug("super provided attributes size: \(fittingAttributes.frame.size)")
        let fittingSize = contentView.systemLayoutSizeFitting(
            CGSize(width: targetWidth, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )

        fittingAttributes.frame.size = CGSize(
            width: targetWidth,
            height: ceil(fittingSize.height)
        )
        Logger.debug("adjusted attributes size: \(fittingAttributes.frame.size)")
        return fittingAttributes
    }
}
