import SwiftUI
import UIKit

extension PromptComposerView {
    struct Editor: View {
        @Environment(\.theme) private var theme: Theme

        @Binding var text: String
        var focused: Binding<Bool>
        let placeholder: String

        var body: some View {
            GrowingTextView(
                text: $text,
                focused: focused,
                font: EditorMetrics.font,
                textColor: UIColor(theme.labelColor),
                textInsets: EditorMetrics.textInsets,
                heightRange: EditorMetrics.heightRange
            )
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .overlay(alignment: .topLeading) {
                placeholderView
            }
        }

        @ViewBuilder
        private var placeholderView: some View {
            if text.isEmpty {
                Text(placeholder)
                    .styledFont(.body)
                    .foregroundStyle(theme.tertiaryLabelColor)
                    .padding(.top, EditorMetrics.textInsets.top)
                    .padding(.leading, EditorMetrics.textInsets.left)
                    .allowsHitTesting(false)
            }
        }
    }

    private enum EditorMetrics {
        static let font = UIFont.systemFont(ofSize: 17, weight: .regular)
        static let horizontalInset: CGFloat = 12
        static let topInset: CGFloat = 12
        static let maxVisibleLines = 6

        static var textInsets: UIEdgeInsets {
            UIEdgeInsets(
                top: topInset,
                left: horizontalInset,
                bottom: 0,
                right: horizontalInset
            )
        }

        static var heightRange: ClosedRange<CGFloat> {
            let insetHeight = textInsets.top + textInsets.bottom
            let minimumHeight = font.lineHeight + insetHeight
            let maximumHeight = (font.lineHeight * CGFloat(maxVisibleLines)) + insetHeight
            return minimumHeight...maximumHeight
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
