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
        // Row height estimates come from the coordinator's estimatedHeightForRowAt
        // delegate method (cached measured heights), which supersedes the
        // estimatedRowHeight property entirely.
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
