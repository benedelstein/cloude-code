import Domain
import Testing
@testable import CloudeCode

struct SessionTranscriptProjectionTests {
    @Test func expandedSetupRunAppearsBeforeFirstAssistantMessage() {
        let items = SessionTranscriptProjection.build(
            messageItems: [userItem(id: "user-1"), assistantItem(id: "assistant-1")],
            setupRun: setupRun(),
            isSetupRunExpanded: true,
            showsSetupRunPlaceholder: false,
            isWorkingIndicatorActive: true
        )

        #expect(items.map(\.id) == [
            "message:user-1",
            "setup-run",
            "message:assistant-1",
            "working"
        ])
    }

    @Test func setupRunFollowsMessagesWhenThereIsNoAssistantMessage() {
        let items = SessionTranscriptProjection.build(
            messageItems: [userItem(id: "user-1")],
            setupRun: setupRun(),
            isSetupRunExpanded: false,
            showsSetupRunPlaceholder: false,
            isWorkingIndicatorActive: false
        )

        #expect(items.map(\.id) == [
            "message:user-1",
            "setup-run",
            "working"
        ])
    }

    @Test func setupRunExpansionReconfiguresOneStableRow() {
        let expandedItems = SessionTranscriptProjection.build(
            messageItems: [],
            setupRun: setupRun(),
            isSetupRunExpanded: true,
            showsSetupRunPlaceholder: false,
            isWorkingIndicatorActive: true
        )
        let collapsedItems = SessionTranscriptProjection.build(
            messageItems: [],
            setupRun: setupRun(),
            isSetupRunExpanded: false,
            showsSetupRunPlaceholder: false,
            isWorkingIndicatorActive: true
        )

        #expect(expandedItems.map(\.id) == ["setup-run", "working"])
        #expect(expandedItems.map(\.id) == collapsedItems.map(\.id))
        #expect(expandedItems != collapsedItems)
    }

    @Test func setupTaskStatusReconfiguresOneStableRow() {
        let pendingItems = SessionTranscriptProjection.build(
            messageItems: [],
            setupRun: setupRun(repositoryStatus: .pending),
            isSetupRunExpanded: true,
            showsSetupRunPlaceholder: false,
            isWorkingIndicatorActive: true
        )
        let completedItems = SessionTranscriptProjection.build(
            messageItems: [],
            setupRun: setupRun(repositoryStatus: .completed),
            isSetupRunExpanded: true,
            showsSetupRunPlaceholder: false,
            isWorkingIndicatorActive: true
        )

        #expect(pendingItems.map(\.id) == ["setup-run", "working"])
        #expect(pendingItems.map(\.id) == completedItems.map(\.id))
        #expect(pendingItems != completedItems)
    }

    @Test func placeholderBecomesLoadedSetupRunInPlace() {
        let messages = [userItem(id: "user-1"), assistantItem(id: "assistant-1")]
        let placeholderItems = SessionTranscriptProjection.build(
            messageItems: messages,
            setupRun: nil,
            isSetupRunExpanded: false,
            showsSetupRunPlaceholder: true,
            isWorkingIndicatorActive: false
        )
        let loadedItems = SessionTranscriptProjection.build(
            messageItems: messages,
            setupRun: setupRun(),
            isSetupRunExpanded: false,
            showsSetupRunPlaceholder: false,
            isWorkingIndicatorActive: false
        )

        #expect(placeholderItems.map(\.id) == [
            "message:user-1",
            "setup-run",
            "message:assistant-1",
            "working"
        ])
        #expect(placeholderItems.map(\.id) == loadedItems.map(\.id))
        #expect(placeholderItems != loadedItems)
    }
}

private extension SessionTranscriptProjectionTests {
    func userItem(id: String) -> SessionTranscriptItem {
        .userMessage(id: SessionTranscriptItem.messageItemID(for: id), .init(
            id: id,
            role: .user,
            text: "Hello"
        ))
    }

    func assistantItem(id: String) -> SessionTranscriptItem {
        let message = SessionMessage(id: id, role: .assistant, text: "Ready")
        return .assistantMessage(
            id: SessionTranscriptItem.messageItemID(for: id),
            .init(id: id, message: message, renderItems: [], finalResponseStartIndex: nil),
            isStreaming: false
        )
    }

    func setupRun(
        repositoryStatus: SessionClientState.SessionSetupTask.Status = .running
    ) -> SessionClientState.SessionSetupRun {
        .init(
            id: "setup-1",
            status: .running,
            startedAt: "2026-01-01T00:00:00Z",
            completedAt: nil,
            tasks: [
                setupTask(id: .cloudContainer, status: .completed),
                setupTask(id: .repository, status: repositoryStatus)
            ]
        )
    }

    func setupTask(
        id: SessionClientState.SessionSetupTask.TaskID,
        status: SessionClientState.SessionSetupTask.Status
    ) -> SessionClientState.SessionSetupTask {
        .init(
            id: id,
            status: status,
            startedAt: nil,
            completedAt: nil,
            error: nil,
            isBlocking: true,
            canRetry: true,
            output: nil
        )
    }
}
