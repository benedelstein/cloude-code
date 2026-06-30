import UIKit
import Domain

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
