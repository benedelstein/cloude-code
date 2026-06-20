import SwiftUI

struct SessionTranscriptFlippedScrollView<Row: View>: View {
    let items: [SessionTranscriptItem]
    let keyboardDismissPadding: CGFloat
    let rowSpacing: CGFloat
    let contentPadding: CGFloat
    @ViewBuilder let rowContent: (SessionTranscriptItem) -> Row

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: rowSpacing) {
                ForEach(items) { item in
                    rowContent(item)
//                        .flippedVertically()
                }
            }
            .padding(.vertical, contentPadding)
            .padding(.bottom, keyboardDismissPadding)
        }
//        .flippedVertically()
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
    }
}

private extension View {
    func flippedVertically() -> some View {
        scaleEffect(x: 1, y: -1, anchor: .center)
    }
}
