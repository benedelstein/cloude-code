import Domain

enum AgentSessionTranscriptBuilder {
    static func build(
        message: SessionMessage,
        clientState: SessionClientState
    ) -> [AgentSessionRenderItem] {
        build(message: message, providerId: providerId(for: message, clientState: clientState))
    }

    static func build(
        message: SessionMessage,
        providerId: AgentProviderID?
    ) -> [AgentSessionRenderItem] {
        var builder = TranscriptRenderItemBuilder(message: message, providerId: providerId)
        return builder.build()
    }

    static func groupActions(_ actions: [NormalizedToolAction]) -> [AgentSessionRenderItem.ActionItem] {
        var result: [AgentSessionRenderItem.ActionItem] = []
        var currentGroup: AgentSessionRenderItem.ActionGroup?

        for (index, action) in actions.enumerated() {
            if action.kind.isGroupable {
                if var group = currentGroup, group.kind == action.kind {
                    group.actions.append(action)
                    currentGroup = group
                    result[result.count - 1] = .group(group)
                    continue
                }

                let group = AgentSessionRenderItem.ActionGroup(
                    kind: action.kind,
                    actions: [action],
                    key: "group-\(action.toolCallId)-\(action.kind.rawValue)"
                )
                currentGroup = group
                result.append(.group(group))
            } else {
                currentGroup = nil
                result.append(.single(.init(
                    action: action,
                    key: "single-\(action.toolCallId)-\(index)"
                )))
            }
        }

        return result.map { item in
            guard case .group(let group) = item, group.actions.count == 1, let action = group.actions.first else {
                return item
            }

            return .single(.init(action: action, key: "single-\(action.toolCallId)"))
        }
    }

    private static func providerId(
        for message: SessionMessage,
        clientState: SessionClientState
    ) -> AgentProviderID? {
        guard message.role == .assistant else {
            return nil
        }
        return clientState.agentSettings.provider
    }
}

private struct PendingActions {
    let keyBase: String
    var actions: [NormalizedToolAction] = []
}

private struct TranscriptRenderItemBuilder {
    let message: SessionMessage
    let providerId: AgentProviderID?
    var items: [AgentSessionRenderItem] = []
    var pendingActions: PendingActions?

    mutating func build() -> [AgentSessionRenderItem] {
        for (index, part) in message.parts.enumerated() {
            process(part: part, index: index)
        }
        flushActions()
        return items
    }

    mutating func process(part: SessionMessage.Part, index: Int) {
        switch part {
        case .text(let text):
            flushActions()
            items.append(.text(.init(key: "\(message.id)-text-\(index)", text: text.text)))
        case .reasoning(let reasoning):
            flushActions()
            items.append(.reasoning(.init(key: "\(message.id)-reasoning-\(index)", part: reasoning)))
        case .dynamicTool, .tool:
            appendToolActions(part: part, index: index)
        case .stepStart:
            return
        case .sourceURL, .sourceDocument, .file, .data, .unknown:
            flushActions()
        }
    }

    mutating func flushActions() {
        guard let pending = pendingActions, !pending.actions.isEmpty else {
            pendingActions = nil
            return
        }

        let grouped = AgentSessionTranscriptBuilder.groupActions(pending.actions)
        for (index, item) in grouped.enumerated() {
            items.append(.actionItem(.init(item, keyBase: pending.keyBase, index: index)))
        }
        pendingActions = nil
    }

    mutating func appendToolActions(part: SessionMessage.Part, index: Int) {
        let actions = ToolActionNormalizer.normalize(part: part, providerId: providerId)
        guard !actions.isEmpty else {
            return
        }

        if pendingActions == nil {
            pendingActions = .init(keyBase: "\(message.id)-actions-\(index)")
        }
        pendingActions?.actions.append(contentsOf: actions)
    }
}

private extension AgentSessionRenderItem.ActionItem {
    init(_ item: AgentSessionRenderItem.ActionItem, keyBase: String, index: Int) {
        switch item {
        case .group(let group):
            self = .group(.init(
                kind: group.kind,
                actions: group.actions,
                key: "\(keyBase)-\(index)-\(group.key)"
            ))
        case .single(let single):
            self = .single(.init(
                action: single.action,
                key: "\(keyBase)-\(index)-\(single.key)"
            ))
        }
    }
}

private extension ToolKind {
    var isGroupable: Bool {
        switch self {
        case .read, .search, .web, .bash, .other:
            true
        case .edit, .write, .todo, .plan:
            false
        }
    }
}
