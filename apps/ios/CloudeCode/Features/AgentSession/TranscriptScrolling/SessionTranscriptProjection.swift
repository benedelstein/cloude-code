import Domain

enum SessionTranscriptProjection {
    static func build(
        messageItems: [SessionTranscriptItem],
        setupRun: SessionClientState.SessionSetupRun?,
        isSetupRunExpanded: Bool,
        showsSetupRunPlaceholder: Bool,
        isWorkingIndicatorActive: Bool
    ) -> [SessionTranscriptItem] {
        var items = messageItems

        let setupItem: SessionTranscriptItem?
        if let setupRun {
            setupItem = .setupRun(.run(setupRun, isExpanded: isSetupRunExpanded))
        } else if showsSetupRunPlaceholder {
            setupItem = .setupRun(.placeholder)
        } else {
            setupItem = nil
        }

        if let setupItem {
            let insertionIndex = items.firstIndex(where: \.isAssistantMessage) ?? items.endIndex
            items.insert(setupItem, at: insertionIndex)
        }

        if !items.isEmpty || isWorkingIndicatorActive {
            items.append(.workingIndicator(isActive: isWorkingIndicatorActive))
        }

        return items
    }
}

private extension SessionTranscriptItem {
    var isAssistantMessage: Bool {
        if case .assistantMessage = self {
            return true
        }
        return false
    }
}
