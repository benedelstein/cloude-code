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

    @Test func submittingMessageTriggersTurnStartHapticWhileViewModelIsBound() {
        let hapticFeedback = RecordingHapticFeedback()
        let viewModel = makeViewModel(hapticFeedback: hapticFeedback)
        viewModel.isBound = true
        viewModel.draftText = "Start a turn"

        viewModel.submitUserMessage()

        #expect(hapticFeedback.events == [.turnStarted])
    }

    @Test func submittingMessageDoesNotTriggerTurnStartHapticWhileViewModelIsUnbound() {
        let hapticFeedback = RecordingHapticFeedback()
        let viewModel = makeViewModel(hapticFeedback: hapticFeedback)
        viewModel.draftText = "Start a turn"

        viewModel.submitUserMessage()

        #expect(hapticFeedback.events.isEmpty)
    }

    @Test func unbindingCancelsPendingHapticFeedback() {
        let hapticFeedback = RecordingHapticFeedback()
        let viewModel = makeViewModel(hapticFeedback: hapticFeedback)
        viewModel.isBound = true

        viewModel.unbind()

        #expect(hapticFeedback.events == [.pendingFeedbackCancelled])
    }

    final class RecordingHapticFeedback: AgentSessionHapticFeedbackProviding {
        enum Event: Equatable {
            case turnStarted
            case turnCompleted
            case pendingFeedbackCancelled
        }

        private(set) var events: [Event] = []

        func turnStarted() {
            events.append(.turnStarted)
        }

        func turnCompleted() {
            events.append(.turnCompleted)
        }

        func cancelPendingFeedback() {
            events.append(.pendingFeedbackCancelled)
        }
    }
}
