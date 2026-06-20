import SwiftUI

@Observable
final class SessionTranscriptScrollCoordinator {
    var showsScrollToBottom = false
    private(set) var scrollToBottomRequestID = 0
    private(set) var isScrollingToBottom = false

    private let showScrollToBottomDistance: CGFloat = 50

    func requestScrollToBottom() {
        scrollToBottomRequestID += 1
        isScrollingToBottom = true
        showsScrollToBottom = false
    }

    func updateDistanceFromBottom(_ distance: CGFloat) {
        let shouldShowScrollToBottom = distance > showScrollToBottomDistance && !isScrollingToBottom
        guard showsScrollToBottom != shouldShowScrollToBottom else { return }

        showsScrollToBottom = shouldShowScrollToBottom
    }

    func finishScrollToBottom() {
        isScrollingToBottom = false
    }
}
