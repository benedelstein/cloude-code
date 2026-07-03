import Domain
import SwiftUI
import UIKit

struct SessionTranscriptTableRepresentable<Row: View>: UIViewRepresentable {
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
            rowSpacing: rowSpacing,
            rowContent: rowContent
        )
    }

    func makeUIView(context: Context) -> LayoutReportingTableView {
        let tableView = LayoutReportingTableView(frame: .zero, style: .plain)
        tableView.backgroundColor = .clear
        tableView.separatorStyle = .none
        tableView.clipsToBounds = false
        tableView.layer.masksToBounds = false
        tableView.alwaysBounceVertical = true
        tableView.keyboardDismissMode = .interactive
        // Insets are owned by the coordinator so safe-area, nav-bar, and composer
        // obstruction handling matches the collection-view transcript path.
        tableView.contentInsetAdjustmentBehavior = .never
        // Apple: The table view ignores the value of this property if its delegate
        // implements the tableView(_:heightForRowAt:) method.
        // Prefer the use of this property over the delegate method
        tableView.rowHeight = UITableView.automaticDimension
        // Apple: Providing a nonnegative estimate of the height of rows can improve
        // the performance of loading the table view. If the table contains variable height
        // rows, it might be expensive to calculate all their heights when the table loads.
        // Estimation allows you to defer some of the cost of geometry calculation from
        // load time to scrolling time.
        //
        // Ben - each cell height can vary wildly, so this isn't super helpful, but
        // better than nothing.
        tableView.estimatedRowHeight = tableEstimatedRowHeight
        tableView.sectionHeaderTopPadding = 0
        if #available(iOS 26.0, *) {
            tableView.topEdgeEffect.style = .soft
            tableView.bottomEdgeEffect.style = .soft
        }
        tableView.onLayoutSubviews = { [weak coordinator = context.coordinator] tableView in
            coordinator?.handleLayoutSubviews(tableView)
        }

        context.coordinator.installDataSource(on: tableView)
        context.coordinator.installScrollDelegate(on: tableView)
        Logger.debug("created session table view")
        return tableView
    }

    func updateUIView(_ tableView: LayoutReportingTableView, context: Context) {
        context.coordinator.update(
            tableView: tableView,
            items: items,
            keyboardDismissPadding: keyboardDismissPadding,
            contentPadding: contentPadding,
            rowContent: rowContent
        )
        context.coordinator.handleScrollRequestIfNeeded(
            scrollRequest,
            in: tableView
        )
    }
}
