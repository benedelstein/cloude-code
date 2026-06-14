@testable import API
import CoreAPI
import Domain
import Testing

@Suite("Session messages")
struct SessionMessagesTests {
    @Test func uiMessageMapsToDomainMessageWithTextPartsOnly() {
        let message = WireUIMessage(
            id: "msg_1",
            role: .assistant,
            parts: [
                .text(.init(text: "First paragraph.")),
                .tool(.init(type: "tool-bash", toolCallId: "call_1", state: .outputAvailable)),
                .text(.init(text: "Second paragraph."))
            ]
        )

        let sessionMessage = SessionMessage(message)

        #expect(sessionMessage.id == "msg_1")
        #expect(sessionMessage.role == .assistant)
        #expect(sessionMessage.text == "First paragraph.\n\nSecond paragraph.")
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
        #expect(clientState.agentSettings.provider == "openai-codex")
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
}
