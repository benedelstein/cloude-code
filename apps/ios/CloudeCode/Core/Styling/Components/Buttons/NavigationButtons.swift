import SwiftUI

struct CloseButton: View {
    @Environment(\.theme) private var theme

    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.secondaryLabelColor)
                .frame(width: 40, height: 40)
                .glassBackground(in: Circle())
                .contentShape(Circle())
        }
        .disabled(isDisabled)
        .accessibilityLabel("Close")
    }
}

struct BackButton: View {
    @Environment(\.theme) private var theme

    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.left")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.secondaryLabelColor)
                .frame(width: 40, height: 40)
                .contentShape(Rectangle().inset(by: -5))
        }
        .disabled(isDisabled)
        .accessibilityLabel("Back")
    }
}

struct ToolbarCloseButton: ToolbarContent {
    @Environment(\.theme) private var theme

    var placement: ToolbarItemPlacement = .topBarLeading
    var isDisabled = false
    let action: () -> Void

    var body: some ToolbarContent {
        ToolbarItem(placement: placement) {
            Button(action: action) {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(theme.secondaryLabelColor)
                    .contentShape(Rectangle().inset(by: -5))
            }
            .disabled(isDisabled)
            .accessibilityLabel("Close")
        }
    }
}

struct ToolbarBackButton: ToolbarContent {
    @Environment(\.theme) private var theme

    var placement: ToolbarItemPlacement = .topBarLeading
    var isDisabled = false
    let action: () -> Void

    var body: some ToolbarContent {
        ToolbarItem(placement: placement) {
            Button(action: action) {
                Image(systemName: "arrow.left")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(theme.secondaryLabelColor)
                    .contentShape(Rectangle().inset(by: -5))
            }
            .disabled(isDisabled)
            .accessibilityLabel("Back")
        }
    }
}
