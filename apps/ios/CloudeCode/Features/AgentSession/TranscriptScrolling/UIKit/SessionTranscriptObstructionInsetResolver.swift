import UIKit

final class SessionTranscriptObstructionInsetResolver {
    private var stableTopInset: CGFloat?

    func contentInsets(for view: UIView) -> UIEdgeInsets {
        guard let window = view.window else {
            return view.safeAreaInsets
        }

        let viewportFrame = view.convert(view.bounds, to: window)
        let navigationController = owningNavigationController(for: view)
        let measuredTopInset = max(
            safeAreaTopHeight(in: window, viewportFrame: viewportFrame),
            navigationBarHeight(
                for: navigationController,
                in: window,
                viewportFrame: viewportFrame
            )
        )

        return UIEdgeInsets(
            top: resolvedTopInset(
                measuredTopInset,
                isNavigationTransitionActive: navigationController?
                    .transitionCoordinator != nil
            ),
            left: 0,
            bottom: safeAreaBottomHeight(in: window, viewportFrame: viewportFrame),
            right: 0
        )
    }

    func reset() {
        stableTopInset = nil
    }

    func resolvedTopInset(
        _ measuredTopInset: CGFloat,
        isNavigationTransitionActive: Bool
    ) -> CGFloat {
        // The shared navigation bar transitions toward the incoming destination.
        // Keep that temporary geometry from moving the outgoing transcript.
        if isNavigationTransitionActive, let stableTopInset {
            return stableTopInset
        }

        stableTopInset = measuredTopInset
        return measuredTopInset
    }

    func owningNavigationController(for view: UIView) -> UINavigationController? {
        var responder: UIResponder? = view

        while let currentResponder = responder {
            if let navigationController = currentResponder as? UINavigationController {
                return navigationController
            }

            if let viewController = currentResponder as? UIViewController,
               let navigationController = viewController.navigationController {
                return navigationController
            }

            responder = currentResponder.next
        }

        return nil
    }

    private func safeAreaTopHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
        max(0, window.safeAreaInsets.top - viewportFrame.minY)
    }

    private func safeAreaBottomHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
        let safeAreaBottomY = window.bounds.maxY - window.safeAreaInsets.bottom
        return max(0, viewportFrame.maxY - safeAreaBottomY)
    }

    private func navigationBarHeight(
        for navigationController: UINavigationController?,
        in window: UIWindow,
        viewportFrame: CGRect
    ) -> CGFloat {
        guard let navigationBar = navigationController?.navigationBar,
              !navigationBar.isHidden,
              navigationBar.window === window else {
            return 0
        }

        let navigationBarFrame = navigationBar.convert(navigationBar.bounds, to: window)
        return max(0, navigationBarFrame.maxY - viewportFrame.minY)
    }
}
