import SwiftUI
import UIKit

extension PromptComposerView {
    struct Editor: View {
        @Environment(\.theme) private var theme: Theme

        @Binding var text: String
        var focused: Binding<Bool>
        let placeholder: String
        let isDisabled: Bool

        var body: some View {
            GrowingTextView(
                text: $text,
                focused: focused,
                font: EditorStyle.font,
                textColor: UIColor(theme.labelColor),
                textInsets: EditorStyle.textInsets,
                maxVisibleLines: EditorStyle.maxVisibleLines,
                isEditable: !isDisabled
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
                    .padding(.top, EditorStyle.textInsets.top)
                    .padding(.leading, EditorStyle.textInsets.left)
                    .allowsHitTesting(false)
            }
        }
    }

    private enum EditorStyle {
        static var font: UIFont { UIFont.systemFont(ofSize: 17, weight: .regular) }
        static var horizontalInset: CGFloat { 16 }
        static var topInset: CGFloat { 16 }
        static var maxVisibleLines: Int { 6 }

        static var textInsets: UIEdgeInsets {
            UIEdgeInsets(
                top: topInset,
                left: horizontalInset,
                bottom: 4,
                right: horizontalInset
            )
        }
    }

    struct SendButton: View {
        @Environment(\.theme) private var theme: Theme
        @Environment(\.lightFeedback) private var lightFeedback: UIImpactFeedbackGenerator

        let isSubmitDisabled: Bool
        let isSubmitting: Bool
        let isResponding: Bool
        let isCancelling: Bool
        let isInterruptDisabled: Bool
        let size: CGFloat
        let onSubmit: () -> Void
        let onStop: () -> Void

        private var showsStop: Bool {
            (isResponding || isCancelling) && !isSubmitting
        }

        var body: some View {
            Button {
                lightFeedback.impactOccurred()
                if showsStop {
                    onStop()
                } else {
                    onSubmit()
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(buttonColor)

                    if isSubmitting || isCancelling {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.white)
                    } else if showsStop {
                        Image(systemName: "square.fill")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.white)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }
                .frame(width: size, height: size)
            }
            .buttonStyle(.bounce(0.95))
            .disabled(isButtonDisabled)
            .accessibilityLabel(accessibilityLabel)
        }

        private var buttonColor: Color {
            if showsStop {
                return theme.errorRed
            }
            return isSubmitting || isSubmitDisabled ? .gray : theme.accentBlue
        }

        private var isButtonDisabled: Bool {
            showsStop
                ? isCancelling || isInterruptDisabled
                : isSubmitDisabled || isSubmitting
        }

        private var accessibilityLabel: String {
            if isCancelling {
                return "Stopping response"
            }
            if showsStop {
                return isInterruptDisabled ? "Response cannot be stopped yet" : "Stop response"
            }
            return "Send"
        }
    }
}
