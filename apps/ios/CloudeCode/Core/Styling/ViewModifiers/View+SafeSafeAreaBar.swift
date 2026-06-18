import SwiftUI

extension View {
    @ViewBuilder
    func safeSafeAreaBar<Content: View>(
        edge: VerticalEdge,
        alignment: HorizontalAlignment = .center,
        spacing: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        if #available(iOS 26.0, *) {
            self.safeAreaBar(
                edge: edge,
                alignment: alignment,
                spacing: spacing,
                content: content
            )
        } else {
            self.safeAreaInset(
                edge: edge,
                alignment: alignment,
                spacing: spacing,
                content: content
            )
        }
    }

    @ViewBuilder
    func safeSafeAreaBar<Content: View>(
        edge: HorizontalEdge,
        alignment: VerticalAlignment = .center,
        spacing: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        if #available(iOS 26.0, *) {
            self.safeAreaBar(
                edge: edge,
                alignment: alignment,
                spacing: spacing,
                content: content
            )
        } else {
            self.safeAreaInset(
                edge: edge,
                alignment: alignment,
                spacing: spacing,
                content: content
            )
        }
    }
}
