import SwiftUI

struct SessionTranscriptScrollView<Row: View>: View {
    @State private var scrollCoordinator = SessionTranscriptScrollCoordinator()

    let items: [SessionTranscriptItem]
    let keyboardDismissPadding: CGFloat
    let rowSpacing: CGFloat
    let contentPadding: CGFloat
    @ViewBuilder let rowContent: (SessionTranscriptItem) -> Row

    var body: some View {
        SessionTranscriptCollectionRepresentable(
            items: items,
            keyboardDismissPadding: keyboardDismissPadding,
            rowSpacing: rowSpacing,
            contentPadding: contentPadding,
            scrollCoordinator: scrollCoordinator,
            scrollToBottomRequestID: scrollCoordinator.scrollToBottomRequestID,
            rowContent: rowContent
        )
        .overlay {
            SessionTranscriptScrollToBottomOverlay(
                isVisible: scrollCoordinator.showsScrollToBottom,
                bottomObstructionHeight: keyboardDismissPadding
            ) {
                scrollCoordinator.requestScrollToBottom()
            }
        }
    }
}
