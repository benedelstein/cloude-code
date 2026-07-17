import Testing
import UIKit
@testable import CloudeCode

@MainActor
struct SessionTranscriptObstructionInsetResolverTests {
    @Test func findsOnlyTheContainingNavigationController() {
        let containingViewController = UIViewController()
        let containingNavigationController = UINavigationController(
            rootViewController: containingViewController
        )
        let unrelatedNavigationController = UINavigationController(
            rootViewController: UIViewController()
        )
        let transcriptView = UIView()
        containingViewController.view.addSubview(transcriptView)

        let resolver = SessionTranscriptObstructionInsetResolver()
        let resolvedNavigationController = resolver.owningNavigationController(
            for: transcriptView
        )

        #expect(resolvedNavigationController === containingNavigationController)
        #expect(resolvedNavigationController !== unrelatedNavigationController)
    }

    @Test func freezesStableTopInsetForEntireNavigationTransition() {
        let resolver = SessionTranscriptObstructionInsetResolver()

        let stableInset = resolver.resolvedTopInset(
            120,
            isNavigationTransitionActive: false
        )
        let interactiveInset = resolver.resolvedTopInset(
            220,
            isNavigationTransitionActive: true
        )
        let postReleaseInset = resolver.resolvedTopInset(
            240,
            isNavigationTransitionActive: true
        )

        #expect(stableInset == 120)
        #expect(interactiveInset == stableInset)
        #expect(postReleaseInset == stableInset)
    }

    @Test func acceptsUpdatedTopInsetAfterNavigationTransition() {
        let resolver = SessionTranscriptObstructionInsetResolver()
        _ = resolver.resolvedTopInset(
            120,
            isNavigationTransitionActive: false
        )

        let updatedInset = resolver.resolvedTopInset(
            220,
            isNavigationTransitionActive: false
        )

        #expect(updatedInset == 220)
    }
}
