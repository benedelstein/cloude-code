@testable import API
import CoreAPI
import Domain
import Testing

@Suite("Session messages")
struct SessionMessagesTests {
    @Test func uiMessageMapsToDomainMessageWithAllParts() {
        let message = WireUIMessage(
            id: "msg_1",
            role: .assistant,
            parts: [
                .text(.init(text: "First paragraph.")),
                .tool(.init(
                    type: "tool-bash",
                    toolCallId: "call_1",
                    state: .outputAvailable,
                    input: .object(["cmd": .string("ls")]),
                    output: .string("README.md")
                )),
                .text(.init(text: "Second paragraph."))
            ]
        )

        let sessionMessage = SessionMessage(message)

        #expect(sessionMessage.id == "msg_1")
        #expect(sessionMessage.role == .assistant)
        #expect(sessionMessage.text == "First paragraph.\n\nSecond paragraph.")
        #expect(sessionMessage.parts.count == 3)
        guard case .tool(let toolPart) = sessionMessage.parts[1] else {
            Issue.record("Expected tool part to be preserved")
            return
        }
        #expect(toolPart.type == "tool-bash")
        #expect(toolPart.toolCallId == "call_1")
        #expect(toolPart.input == .object(["cmd": .string("ls")]))
        #expect(toolPart.output == .string("README.md"))
    }

    @Test func streamChunkExposesTextDelta() {
        let chunk = SessionStreamChunk(.textDelta(.init(id: "text-1", delta: "Hello")))

        #expect(chunk.textDelta == "Hello")
    }

    @Test func streamChunkIgnoresNonTextDelta() {
        let chunk = SessionStreamChunk(.finish(.init()))

        #expect(chunk.textDelta == nil)
    }

    @Test func streamStateReducesSDKChunksIntoSessionMessage() async throws {
        let state = await SessionMessageStreamState.reducing([
            SessionStreamChunk(.start(.init(messageId: "message-1"))),
            SessionStreamChunk(.textStart(.init(id: "text-1"))),
            SessionStreamChunk(.textDelta(.init(id: "text-1", delta: "Hel"))),
            SessionStreamChunk(.textDelta(.init(id: "text-1", delta: "lo"))),
            SessionStreamChunk(.textEnd(.init(id: "text-1"))),
            SessionStreamChunk(.finish(.init(finishReason: .stop)))
        ])

        #expect(state.message?.id == "message-1")
        #expect(state.text == "Hello")
        #expect(state.errorDescription == nil)
    }

    @Test func streamStateFallsBackToTextDeltasWhenSDKProducesNoMessage() async throws {
        let state = await SessionMessageStreamState.reducing([
            SessionStreamChunk(.textDelta(.init(id: "text-1", delta: "Hello")))
        ])

        #expect(state.message == nil)
        #expect(state.text == "Hello")
        #expect(state.errorDescription == nil)
    }

    @Test func streamStateSkipsUnknownChunksWithoutError() async throws {
        let state = await SessionMessageStreamState.reducing([
            SessionStreamChunk(.unknown(type: "future-chunk", rawValue: .object([
                "type": .string("future-chunk"),
                "payload": .object(["opaque": .bool(true)])
            ])))
        ])

        #expect(state.message == nil)
        #expect(state.text == "")
        #expect(state.errorDescription == nil)
    }

    @Test func clientStateMapsWebUsedFieldsToDomainState() {
        let state = ClientState(
            repoFullName: "benedelstein/cloude-code",
            status: .ready,
            sessionSetupRun: SessionSetupRun(
                id: "setup_1",
                status: .running,
                startedAt: "2026-06-13T00:00:00.000Z",
                tasks: [
                    .repository(RepositorySetupTask(status: .completed))
                ]
            ),
            agentSettings: .openaiCodex(AgentSettingsCodex(model: .gpt55, effort: .high, maxTokens: 4096)),
            pullRequest: .creating(PullRequestClientState.Creating()),
            pushedBranch: "codex/session-client-state",
            baseBranch: "main",
            todos: [
                SessionTodo(content: "Render messages", status: .inProgress)
            ],
            plan: SessionPlanMetadata(lastUpdated: "2026-06-13T00:01:00.000Z"),
            pendingUserMessage: PendingUserMessage(
                message: WireUIMessage(
                    id: "pending_1",
                    role: .user,
                    parts: [
                        .text(.init(text: "Hello"))
                    ]
                ),
                attachmentIds: []
            ),
            activeTurn: ActiveTurnState(userMessageId: "pending_1"),
            editorUrl: "https://example.com/editor",
            providerConnection: ProviderConnectionState(
                provider: .openaiCodex,
                connected: true,
                requiresReauth: false
            ),
            agentMode: .edit,
            lastError: nil,
            createdAt: "2026-06-13T00:00:00.000Z"
        )

        let clientState = SessionClientState(state)

        #expect(clientState.repoFullName == "benedelstein/cloude-code")
        #expect(clientState.status == "ready")
        #expect(clientState.sessionSetupRun?.tasks.first?.id == "repository")
        #expect(clientState.agentSettings.provider == .openaiCodex)
        #expect(clientState.agentSettings.model == "gpt-5.5")
        #expect(clientState.pullRequest == .creating)
        #expect(clientState.pushedBranch == "codex/session-client-state")
        #expect(clientState.baseBranch == "main")
        #expect(clientState.todos?.first?.status == "in_progress")
        #expect(clientState.plan?.lastUpdated == "2026-06-13T00:01:00.000Z")
        #expect(clientState.pendingUserMessage?.text == "Hello")
        #expect(clientState.activeTurnUserMessageId == "pending_1")
        #expect(clientState.editorURL == "https://example.com/editor")
        #expect(clientState.providerConnection?.connected == true)
        #expect(clientState.agentMode == "edit")
        #expect(clientState.createdAt == "2026-06-13T00:00:00.000Z")
    }

    @Test func sessionSummaryIDsAreOpaqueStrings() {
        let summary = CoreAPI.SessionSummary(
            id: "session_custom_ID",
            repoId: 1,
            repoFullName: "ben/cloude-code",
            title: nil,
            archived: false,
            workingState: .idle,
            pushedBranch: nil,
            pullRequest: nil,
            createdAt: "2026-06-13T00:00:00.000Z",
            updatedAt: "2026-06-13T00:00:00.000Z",
            lastMessageAt: nil,
            lastAssistantMessageId: nil,
            hasUnread: false
        )

        #expect(summary.domainSummary.id == "session_custom_ID")
    }
}
