import SwiftUI
import UIKit

extension PromptComposerView {
    struct Editor: View {
        @Environment(\.theme) private var theme: Theme

        @Binding var text: String
        var focused: FocusState<Bool>.Binding
        let placeholder: String

        @State private var measuredTextHeight = EditorMetrics.font.lineHeight

        var body: some View {
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .styledFont(.body)
                        .foregroundStyle(theme.tertiaryLabelColor)
                }

                GrowingTextView(
                    text: $text,
                    focused: focused,
                    measuredHeight: $measuredTextHeight,
                    font: EditorMetrics.font,
                    textColor: UIColor(theme.labelColor),
                    heightRange: EditorMetrics.heightRange
                )
            }
            .frame(height: measuredTextHeight)
            .padding(.horizontal, EditorMetrics.horizontalInset)
            .padding(.top, EditorMetrics.topInset)
            .animation(.snappy(duration: 0.16), value: measuredTextHeight)
        }
    }

    private enum EditorMetrics {
        static let font = UIFont.systemFont(ofSize: 17, weight: .regular)
        static let horizontalInset: CGFloat = 12
        static let topInset: CGFloat = 12
        static let maxVisibleLines = 6

        static var heightRange: ClosedRange<CGFloat> {
            font.lineHeight...(font.lineHeight * CGFloat(maxVisibleLines))
        }
    }

    private struct GrowingTextView: UIViewRepresentable {
        @Binding var text: String
        var focused: FocusState<Bool>.Binding
        @Binding var measuredHeight: CGFloat
        let font: UIFont
        let textColor: UIColor
        let heightRange: ClosedRange<CGFloat>

        func makeUIView(context: Context) -> UITextView {
            let textView = UITextView()
            textView.delegate = context.coordinator
            textView.backgroundColor = .clear
            textView.font = font
            textView.textColor = textColor
            textView.textContainerInset = .zero
            textView.textContainer.lineFragmentPadding = 0
            textView.keyboardDismissMode = .interactive
            textView.alwaysBounceVertical = true
            textView.showsVerticalScrollIndicator = true
            textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            return textView
        }

        func updateUIView(_ textView: UITextView, context: Context) {
            context.coordinator.parent = self
            if textView.text != text {
                textView.text = text
            }
            textView.font = font
            textView.textColor = textColor
            context.coordinator.updateFocus(in: textView)
            context.coordinator.updateHeight(for: textView)
        }

        func makeCoordinator() -> Coordinator {
            Coordinator(parent: self)
        }

        final class Coordinator: NSObject, UITextViewDelegate {
            var parent: GrowingTextView

            init(parent: GrowingTextView) {
                self.parent = parent
            }

            func textViewDidBeginEditing(_ textView: UITextView) {
                parent.focused.wrappedValue = true
            }

            func textViewDidEndEditing(_ textView: UITextView) {
                parent.focused.wrappedValue = false
            }

            func textViewDidChange(_ textView: UITextView) {
                parent.text = textView.text
                updateHeight(for: textView)
            }

            func updateFocus(in textView: UITextView) {
                if parent.focused.wrappedValue, !textView.isFirstResponder {
                    textView.becomeFirstResponder()
                } else if !parent.focused.wrappedValue, textView.isFirstResponder {
                    textView.resignFirstResponder()
                }
            }

            func updateHeight(for textView: UITextView) {
                let targetWidth = textView.bounds.width
                guard targetWidth > 0 else { return }

                let fittingSize = textView.sizeThatFits(CGSize(
                    width: targetWidth,
                    height: .greatestFiniteMagnitude
                ))
                let clampedHeight = min(
                    max(ceil(fittingSize.height), parent.heightRange.lowerBound),
                    parent.heightRange.upperBound
                )
                textView.isScrollEnabled = fittingSize.height > parent.heightRange.upperBound + 0.5

                guard abs(parent.measuredHeight - clampedHeight) > 0.5 else { return }
                DispatchQueue.main.async {
                    self.parent.measuredHeight = clampedHeight
                }
            }
        }
    }

    struct SendButton: View {
        @Environment(\.theme) private var theme: Theme
        @Environment(\.lightFeedback) private var lightFeedback: UIImpactFeedbackGenerator

        let isSubmitDisabled: Bool
        let isSubmitting: Bool
        let size: CGFloat
        let onSubmit: () -> Void

        var body: some View {
            Button {
                lightFeedback.impactOccurred()
                onSubmit()
            } label: {
                ZStack {
                    Circle()
                        .fill(isSubmitting || isSubmitDisabled ? .gray : theme.accentBlue)

                    if isSubmitting {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }
                .frame(width: size, height: size)
            }
            .buttonStyle(.bounce(0.95))
            .foregroundStyle(isSubmitDisabled ? theme.secondaryLabelColor : theme.accentBlue)
            .disabled(isSubmitDisabled || isSubmitting)
            .accessibilityLabel("Send")
        }
    }
}
