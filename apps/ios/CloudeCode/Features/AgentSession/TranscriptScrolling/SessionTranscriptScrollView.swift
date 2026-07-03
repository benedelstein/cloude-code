import SwiftUI

enum SessionTranscriptScrollImplementation {
    case collection
    case table
}

struct SessionTranscriptScrollView<Row: View>: View {
    let items: [SessionTranscriptItem]
    let keyboardDismissPadding: CGFloat
    let rowSpacing: CGFloat
    let contentPadding: CGFloat
    let scrollCoordinator: SessionTranscriptScrollCoordinator
    var implementation: SessionTranscriptScrollImplementation = .table
    @ViewBuilder let rowContent: (SessionTranscriptItem) -> Row

    var body: some View {
        switch implementation {
        case .collection:
            SessionTranscriptCollectionRepresentable(
                items: items,
                keyboardDismissPadding: keyboardDismissPadding,
                rowSpacing: rowSpacing,
                contentPadding: contentPadding,
                scrollCoordinator: scrollCoordinator,
                scrollRequest: scrollCoordinator.scrollRequest,
                rowContent: rowContent
            )
        case .table:
            SessionTranscriptTableRepresentable(
                items: items,
                keyboardDismissPadding: keyboardDismissPadding,
                rowSpacing: rowSpacing,
                contentPadding: contentPadding,
                scrollCoordinator: scrollCoordinator,
                scrollRequest: scrollCoordinator.scrollRequest,
                rowContent: rowContent
            )
        }
    }
}
