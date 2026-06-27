import UIKit

enum SessionTranscriptScrollMetrics {
    static let bottomDistanceEpsilon: CGFloat = 0.5
    static let bottomProximityThreshold: CGFloat = 50
}

struct SessionTranscriptContentInsetConfiguration: Equatable {
    var contentPadding: CGFloat = 0
    var bottomOverlayHeight: CGFloat = 0
}

struct SessionTranscriptInitialAnchorGeometry: Equatable {
    let boundsSize: CGSize
    let contentSize: CGSize
}

struct SessionTranscriptLayoutChange {
    let boundsChanged: Bool
    let contentSizeChanged: Bool
    let didUpdateContentInsets: Bool

    var didChangeLayout: Bool {
        boundsChanged || contentSizeChanged || didUpdateContentInsets
    }

    func shouldAnimateBottomPreservation(keyboardTransition: KeyboardTransition?) -> Bool {
        // Only content-size-only updates should animate. Bounds and inset changes
        // represent viewport movement, such as interactive keyboard drag dismissal, so
        // bottom preservation must track those layout changes immediately.
        contentSizeChanged
            && !boundsChanged
            && !didUpdateContentInsets
            // Keyboard transitions use their own UIKit timing.
            && keyboardTransition == nil
            && UIView.areAnimationsEnabled
    }
}

// Initial bottom anchoring is intentionally modeled as one state value so the
// snapshot, measurement, correction, and reveal steps cannot drift apart.
enum SessionTranscriptInitialAnchorState {
    case waitingForItems
    case applyingSnapshot
    case anchoring(lastGeometry: SessionTranscriptInitialAnchorGeometry?, attempts: Int)
    case complete
}
