@testable import API
import CoreAPI
import Testing
@testable import CloudeCode

extension AgentSessionTranscriptStateTests {
    @Test func agentFinishTriggersCompletionHapticWhileViewModelIsBound() {
        let hapticFeedback = RecordingHapticFeedback()
        let viewModel = makeViewModel(hapticFeedback: hapticFeedback)
        viewModel.isBound = true

        viewModel.applyAgentFinish(assistantMessage(id: "assistant-1", text: "Complete"))

        #expect(hapticFeedback.events == [.turnCompleted])
    }

    @Test func agentFinishDoesNotTriggerCompletionHapticWhileViewModelIsUnbound() {
        let hapticFeedback = RecordingHapticFeedback()
        let viewModel = makeViewModel(hapticFeedback: hapticFeedback)

        viewModel.applyAgentFinish(assistantMessage(id: "assistant-1", text: "Complete"))

        #expect(hapticFeedback.events.isEmpty)
    }

    @Test func firstLiveChunkTriggersTurnStartHapticWhileViewModelIsBound() async {
        let hapticFeedback = RecordingHapticFeedback()
        let viewModel = makeViewModel(hapticFeedback: hapticFeedback)
        viewModel.isBound = true

        await viewModel.handle(.agentChunks(chunks: [], messageMetadata: nil))
        await viewModel.handle(.agentChunks(
            chunks: initialMessageChunks(),
            messageMetadata: nil
        ))
        await viewModel.handle(.agentChunks(
            chunks: [messageDeltaChunk(delta: "Second")],
            messageMetadata: nil
        ))

        #expect(hapticFeedback.events == [.turnStarted])
    }

    @Test func firstLiveChunkDoesNotTriggerTurnStartHapticWhileViewModelIsUnbound() async {
        let hapticFeedback = RecordingHapticFeedback()
        let viewModel = makeViewModel(hapticFeedback: hapticFeedback)

        await viewModel.handle(.agentChunks(
            chunks: initialMessageChunks(),
            messageMetadata: nil
        ))

        #expect(hapticFeedback.events.isEmpty)
    }

    @Test func bindingPreparesAndUnbindingStopsHapticFeedback() async {
        let hapticFeedback = RecordingHapticFeedback()
        let viewModel = makeViewModel(hapticFeedback: hapticFeedback)

        let bindTask = Task {
            await viewModel.bind()
        }
        await Task.yield()
        viewModel.unbind()
        await bindTask.value

        #expect(hapticFeedback.events.first == .prepared)
        #expect(hapticFeedback.events.last == .stopped)
    }

    final class RecordingHapticFeedback: AgentSessionHapticFeedbackProviding {
        enum Event: Equatable {
            case prepared
            case turnStarted
            case turnCompleted
            case stopped
        }

        private(set) var events: [Event] = []

        func prepare() {
            events.append(.prepared)
        }

        func turnStarted() {
            events.append(.turnStarted)
        }

        func turnCompleted() {
            events.append(.turnCompleted)
        }

        func stop() {
            events.append(.stopped)
        }
    }

    private func initialMessageChunks() -> [SessionStreamChunk] {
        [
            SessionStreamChunk(.start(.init(messageId: "message-1"))),
            SessionStreamChunk(.textStart(.init(id: "text-1"))),
            messageDeltaChunk(delta: "First")
        ]
    }

    private func messageDeltaChunk(delta: String) -> SessionStreamChunk {
        SessionStreamChunk(.textDelta(.init(id: "text-1", delta: delta)))
    }
}
