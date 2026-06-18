import SwiftUI
import Domain

struct AssistantMessageView: View {
    private let partSpacing: CGFloat = 12

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
                isActive: isActive
            ) {
                destination = .sheet(.renderItem(item))
            }
        }
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
