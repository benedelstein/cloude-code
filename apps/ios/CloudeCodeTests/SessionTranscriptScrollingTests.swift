@testable import CloudeCode
import CoreGraphics
import Domain
import Testing

@Suite("Session transcript scrolling")
struct SessionTranscriptScrollingTests {
    @Test func itemIDHelpersMatchTranscriptItemIdentity() {
        let userMessage = SessionMessage(id: "user-1", role: .user, parts: [])
        let assistantMessage = SessionMessage(id: "assistant-1", role: .assistant, parts: [])
        let displayData = AgentSessionView.MessageDisplayData(
            message: assistantMessage,
            renderItems: [],
            finalResponseStartIndex: nil
        )

        #expect(SessionTranscriptItem.messageItemID(for: "message-1") == "message:message-1")
        #expect(SessionTranscriptItem.streamingItemID(for: "message-1") == "streaming:message-1")
        #expect(SessionTranscriptItem.workingItemID == "working")
        #expect(SessionTranscriptItem.userMessage(userMessage).id == "message:user-1")
        #expect(SessionTranscriptItem.assistantMessage(
            displayData,
            isStreaming: false,
            autoCollapse: false
        ).id == "message:assistant-1")
        #expect(SessionTranscriptItem.assistantMessage(
            displayData,
            isStreaming: true,
            autoCollapse: false
        ).id == "streaming:assistant-1")
        #expect(SessionTranscriptItem.workingIndicator(isActive: true).id == "working")
        #expect(SessionTranscriptItem.workingIndicator(isActive: false).id == "working")
        #expect(SessionTranscriptItem.workingIndicator(isActive: true) != .workingIndicator(isActive: false))
    }

    @Test func repeatedScrollRequestsKeepUniqueIdentities() {
        let coordinator = SessionTranscriptScrollCoordinator()

        coordinator.scroll(to: .top, animated: false)
        let firstRequest = coordinator.scrollRequest

        coordinator.scroll(to: .top, animated: false)
        let secondRequest = coordinator.scrollRequest

        #expect(firstRequest?.destination == .top)
        #expect(secondRequest?.destination == .top)
        #expect(firstRequest?.id == 1)
        #expect(secondRequest?.id == 2)
        #expect(coordinator.isScrollingToBottom == false)
    }

    @Test func bottomRequestsHideButtonUntilScrollCompletes() {
        let coordinator = SessionTranscriptScrollCoordinator()
        coordinator.updateDistanceFromBottom(100)

        coordinator.requestScrollToBottom()

        #expect(coordinator.scrollRequest?.destination == .bottom)
        #expect(coordinator.scrollRequest?.alignment == .bottom)
        #expect(coordinator.scrollRequest?.animated == true)
        #expect(coordinator.isScrollingToBottom == true)
        #expect(coordinator.showsScrollToBottom == false)

        coordinator.finishScrollToBottom()

        #expect(coordinator.isScrollingToBottom == false)
    }

    @Test func nonBottomRequestsDoNotSuppressBottomButtonState() {
        let coordinator = SessionTranscriptScrollCoordinator()
        coordinator.updateDistanceFromBottom(100)

        coordinator.scroll(to: .message(id: "message-1"), animated: false)

        #expect(coordinator.scrollRequest?.destination == .message(id: "message-1"))
        #expect(coordinator.scrollRequest?.alignment == .center)
        #expect(coordinator.scrollRequest?.animated == false)
        #expect(coordinator.isScrollingToBottom == false)
        #expect(coordinator.showsScrollToBottom == true)
    }

    @Test func nonBottomRequestsCancelBottomScrollSuppression() {
        let coordinator = SessionTranscriptScrollCoordinator()

        coordinator.requestScrollToBottom()
        coordinator.scroll(to: .top, animated: false)

        #expect(coordinator.scrollRequest?.destination == .top)
        #expect(coordinator.isScrollingToBottom == false)
    }
}
