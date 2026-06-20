import UIKit

struct SessionTranscriptContentInsetConfiguration: Equatable {
    var contentPadding: CGFloat = 0
    var bottomOverlayHeight: CGFloat = 0
}

struct SessionTranscriptInitialAnchorGeometry: Equatable {
    let boundsSize: CGSize
    let contentSize: CGSize
}

// Initial bottom anchoring is intentionally modeled as one state value so the
// snapshot, measurement, correction, and reveal steps cannot drift apart.
enum SessionTranscriptInitialAnchorState {
    case waitingForItems
    case applyingSnapshot
    case anchoring(lastGeometry: SessionTranscriptInitialAnchorGeometry?, attempts: Int)
    case complete
}
