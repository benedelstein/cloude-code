import UIKit
import Domain
import SwiftUI

struct SessionTranscriptCollectionRepresentable<Row: View>: UIViewRepresentable {
    let items: [SessionTranscriptItem]
    let keyboardDismissPadding: CGFloat
    let rowSpacing: CGFloat
    let contentPadding: CGFloat
    let scrollCoordinator: SessionTranscriptScrollCoordinator
    let scrollRequest: SessionTranscriptScrollRequest?
    let rowContent: (SessionTranscriptItem) -> Row

    func makeCoordinator() -> Coordinator {
        Coordinator(
            scrollCoordinator: scrollCoordinator,
            rowContent: rowContent
        )
    }

    func makeUIView(context: Context) -> LayoutReportingCollectionView {
        let collectionView = LayoutReportingCollectionView(
            frame: .zero,
            collectionViewLayout: makeLayout()
        )

        collectionView.backgroundColor = .clear
        collectionView.clipsToBounds = false
        collectionView.layer.masksToBounds = false
        collectionView.alwaysBounceVertical = true
        collectionView.keyboardDismissMode = .interactive
        collectionView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 26.0, *) {
            collectionView.topEdgeEffect.style = .soft
            collectionView.bottomEdgeEffect.style = .soft
        }
        collectionView.onBeforeLayoutSubviews = { [weak coordinator = context.coordinator] collectionView in
            coordinator?.prepareWorkingIndicatorLayoutTransition(collectionView)
        }
        collectionView.onLayoutSubviews = { [weak coordinator = context.coordinator] collectionView in
            coordinator?.handleLayoutSubviews(collectionView)
        }

        context.coordinator.installDataSource(on: collectionView)
        context.coordinator.installScrollDelegate(on: collectionView)
        Logger.debug("created session collection view")
        return collectionView
    }

    func updateUIView(_ collectionView: LayoutReportingCollectionView, context: Context) {
        context.coordinator.update(
            collectionView: collectionView,
            items: items,
            keyboardDismissPadding: keyboardDismissPadding,
            contentPadding: contentPadding,
            rowContent: rowContent
        )
        context.coordinator.handleScrollRequestIfNeeded(
            scrollRequest,
            in: collectionView
        )
    }
}
