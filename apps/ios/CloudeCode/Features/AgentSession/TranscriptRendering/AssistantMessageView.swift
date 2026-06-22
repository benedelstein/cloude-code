import SwiftUI
import Domain

struct AssistantMessageView: View, Equatable {
    // for better scroll performance.
    static func == (lhs: AssistantMessageView, rhs: AssistantMessageView) -> Bool {
        lhs.displayData == rhs.displayData &&
        lhs.isStreaming == rhs.isStreaming &&
        lhs.autoCollapseOnAppear == rhs.autoCollapseOnAppear &&
        lhs.hasConsumedAutoCollapse == rhs.hasConsumedAutoCollapse &&
        lhs.workExpanded == rhs.workExpanded &&
        lhs.destination?.id == rhs.destination?.id
    }

    private let partSpacing: CGFloat = 12
    private let renderItemInsertionTransition = AnyTransition
        .opacity
        .combined(with: .move(edge: .top))

    let displayData: AgentSessionView.MessageDisplayData
    let isStreaming: Bool
    let autoCollapseOnAppear: Bool
    @Binding var destination: Modal<AgentSessionView.Destination>?
    var onAutoCollapseConsumed: () -> Void = {}

    @State private var workExpanded = false
    @State private var hasConsumedAutoCollapse = false

    @ViewBuilder
    var body: some View {
        VStack(alignment: .leading, spacing: partSpacing) {
            let items = displayData.renderItems
            let finalResponseStartIndex = displayData.finalResponseStartIndex
            let showsCollapsibleWorkTrace = !isStreaming && finalResponseStartIndex != nil

            if isStreaming || showsCollapsibleWorkTrace {
                TurnWorkHeaderView(
                    expanded: workExpanded || isStreaming,
                    startedAt: displayData.message.workStartedAt,
                    endedAt: displayData.message.workEndedAt,
                    isStreaming: isStreaming,
                    collapsible: showsCollapsibleWorkTrace
                ) {
                    guard !isStreaming else { return }
                    withAnimation(.easeOut(duration: 0.2)) {
                        workExpanded.toggle()
                    }
                }
            }

            if showsCollapsibleWorkTrace, let finalResponseStartIndex, workExpanded {
                renderRows(
                    Array(items.prefix(finalResponseStartIndex)),
                    fullItems: items,
                    indexOffset: 0
                )
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            renderRows(
                Array(items.dropFirst(finalResponseStartIndex ?? 0)),
                fullItems: items,
                indexOffset: finalResponseStartIndex ?? 0
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
//        .animation(.easeOut(duration: 0.2), value: displayData.renderItems)
        .onAppear(perform: configureInitialCollapse)
        .onChange(of: autoCollapseOnAppear) { _, _ in
            configureInitialCollapse()
        }
    }

    @ViewBuilder
    private func renderRows(
        _ items: [AgentSessionRenderItem],
        fullItems: [AgentSessionRenderItem],
        indexOffset: Int
    ) -> some View {
        ForEach(Array(items.enumerated()), id: \.element.key) { index, item in
            let fullIndex = index + indexOffset
            let isActive = isActiveFinalGroup(
                item: item,
                index: fullIndex,
                items: fullItems
            )

            AgentSessionRenderItemView(
                item: item,
                isActive: isActive,
                isStreaming: isStreaming
            ) {
                destination = .sheet(.renderItem(item))
            }
            .transition(renderItemInsertionTransition)
        }
    }

    private var renderItemKeys: [String] {
        displayData.renderItems.map(\.key)
    }

    private func configureInitialCollapse() {
        guard displayData.finalResponseStartIndex != nil else {
            onAutoCollapseConsumed()
            return
        }
        guard autoCollapseOnAppear, !hasConsumedAutoCollapse else {
            return
        }

        workExpanded = true
        hasConsumedAutoCollapse = true
        onAutoCollapseConsumed()

        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.2)) {
                workExpanded = false
            }
        }
    }

    private func isActiveFinalGroup(
        item: AgentSessionRenderItem,
        index: Int,
        items: [AgentSessionRenderItem]
    ) -> Bool {
        guard isStreaming, index == items.endIndex - 1 else {
            return false
        }
        if case .actionItem(.group) = item {
            return true
        }
        return false
    }
}
