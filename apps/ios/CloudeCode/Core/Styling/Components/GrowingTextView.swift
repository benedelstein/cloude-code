import SwiftUI
import UIKit

/// A UIKit-backed multiline text view that self-sizes until its maximum height.
struct GrowingTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool
    let font: UIFont
    let textColor: UIColor
    let textInsets: UIEdgeInsets
    let maxVisibleLines: Int
    let isEditable: Bool

    func makeUIView(context: Context) -> SizingTextView {
        let textView = SizingTextView()
        textView.delegate = context.coordinator
        textView.backgroundColor = .clear
        textView.font = font
        textView.textColor = textColor
        textView.textContainerInset = textInsets
        textView.textContainer.lineFragmentPadding = 0
        textView.keyboardDismissMode = .none
        textView.alwaysBounceVertical = false
        textView.showsVerticalScrollIndicator = true
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        textView.onLayout = { textView in
            context.coordinator.updateScrollState(for: textView)
        }
        return textView
    }

    func updateUIView(_ textView: SizingTextView, context: Context) {
        context.coordinator.parent = self
        if textView.text != text {
            textView.text = text
        }
        textView.font = font
        textView.textColor = textColor
        textView.textContainerInset = textInsets
        textView.isEditable = isEditable
        context.coordinator.updateFocus(in: textView)
        context.coordinator.updateScrollState(for: textView)
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: SizingTextView,
        context: Context
    ) -> CGSize? {
        let targetWidth = proposal.width ?? uiView.bounds.width
        guard targetWidth > 0 else { return nil }

        let fittingHeight = Self.fittingHeight(for: uiView, width: targetWidth)
        return CGSize(
            width: targetWidth,
            height: Self.clampedHeight(fittingHeight, in: heightRange)
        )
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    private var heightRange: ClosedRange<CGFloat> {
        let visibleLineCount = max(1, maxVisibleLines)
        let insetHeight = textInsets.top + textInsets.bottom
        let minimumHeight = font.lineHeight + insetHeight
        let maximumHeight = (font.lineHeight * CGFloat(visibleLineCount)) + insetHeight
        return minimumHeight...maximumHeight
    }

    private static func fittingHeight(for textView: UITextView, width: CGFloat) -> CGFloat {
        let fittingSize = textView.sizeThatFits(CGSize(
            width: width,
            height: .greatestFiniteMagnitude
        ))
        return ceil(fittingSize.height)
    }

    private static func clampedHeight(
        _ height: CGFloat,
        in range: ClosedRange<CGFloat>
    ) -> CGFloat {
        min(max(height, range.lowerBound), range.upperBound)
    }

    final class SizingTextView: UITextView {
        var onLayout: ((SizingTextView) -> Void)?

        override func layoutSubviews() {
            super.layoutSubviews()
            onLayout?(self)
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: GrowingTextView

        init(parent: GrowingTextView) {
            self.parent = parent
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            guard !parent.focused else { return }

            parent.focused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            guard parent.focused else { return }

            // todo: modifying state during view update
            parent.focused = false
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            updateScrollState(for: textView)
        }

        func updateFocus(in textView: UITextView) {
            guard parent.isEditable else {
                if textView.isFirstResponder {
                    textView.resignFirstResponder()
                }
                return
            }
            if parent.focused, !textView.isFirstResponder {
                textView.becomeFirstResponder()
            } else if !parent.focused, textView.isFirstResponder {
                textView.resignFirstResponder()
            }
        }

        func updateScrollState(for textView: UITextView) {
            let targetWidth = textView.bounds.width
            guard targetWidth > 0 else { return }

            let fittingHeight = GrowingTextView.fittingHeight(for: textView, width: targetWidth)
            let shouldScroll = fittingHeight > parent.heightRange.upperBound + 0.5
            if textView.isScrollEnabled != shouldScroll {
                textView.isScrollEnabled = shouldScroll
            }
            textView.alwaysBounceVertical = shouldScroll
        }
    }
}
