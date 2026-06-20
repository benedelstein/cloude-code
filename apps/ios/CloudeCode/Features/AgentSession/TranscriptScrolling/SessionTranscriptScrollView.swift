import SwiftUI

struct SessionTranscriptScrollView<Row: View>: View {
    let items: [SessionTranscriptItem]
    let keyboardDismissPadding: CGFloat
    let rowSpacing: CGFloat
    let contentPadding: CGFloat
    let scrollCoordinator: SessionTranscriptScrollCoordinator
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
    }
}
