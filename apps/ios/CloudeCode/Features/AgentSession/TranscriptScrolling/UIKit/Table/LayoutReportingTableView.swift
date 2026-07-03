import Domain
import UIKit

final class LayoutReportingTableView: UITableView, SessionTranscriptKeyboardTransitionReporting {
    /// Called after UIKit completes this table view's layout pass.
    var onLayoutSubviews: ((LayoutReportingTableView) -> Void)?
    /// Most recent keyboard transition waiting to be consumed by the transcript coordinator.
    private(set) var pendingKeyboardTransition: KeyboardTransition?
    private let keyboardTransitionObserver: KeyboardTransitionObserving

    /// Creates a table view that reports layout passes and keyboard transitions.
    init(
        frame: CGRect,
        style: UITableView.Style,
        keyboardTransitionObserver: KeyboardTransitionObserving = NotificationKeyboardTransitionObserver()
    ) {
        self.keyboardTransitionObserver = keyboardTransitionObserver
        super.init(frame: frame, style: style)
        configureKeyboardTransitionObserver()
    }

    required init?(coder: NSCoder) {
        keyboardTransitionObserver = NotificationKeyboardTransitionObserver()
        super.init(coder: coder)
        configureKeyboardTransitionObserver()
    }

    deinit {
        keyboardTransitionObserver.stop()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayoutSubviews?(self)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updateKeyboardObservers()
    }

    /// Returns manual insets for the safe areas and navigation bars this table intentionally overlaps.
    func contentInsets() -> UIEdgeInsets {
        guard let window, let viewportFrame = viewportFrame(in: window) else {
            return safeAreaInsets
        }

        return UIEdgeInsets(
            top: max(
                safeAreaTopHeight(in: window, viewportFrame: viewportFrame),
                navigationBarHeight(in: window, viewportFrame: viewportFrame)
            ),
            left: 0,
            bottom: safeAreaBottomHeight(in: window, viewportFrame: viewportFrame),
            right: 0
        )
    }

    /// Marks the pending keyboard transition as consumed.
    func clearPendingKeyboardTransition() {
        pendingKeyboardTransition = nil
    }

    private func updateKeyboardObservers() {
        keyboardTransitionObserver.stop()
        pendingKeyboardTransition = nil

        guard window != nil else { return }

        keyboardTransitionObserver.start(in: self)
    }

    private func configureKeyboardTransitionObserver() {
        keyboardTransitionObserver.onTransition = { [weak self] transition in
            self?.handleKeyboardTransition(transition)
        }
    }

    private func handleKeyboardTransition(_ transition: KeyboardTransition) {
        // Layout consumes this later so offset updates can use the keyboard's timing.
        pendingKeyboardTransition = transition
        setNeedsLayout()
    }

    private func safeAreaTopHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
        max(0, window.safeAreaInsets.top - viewportFrame.minY)
    }

    private func safeAreaBottomHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
        let safeAreaBottomY = window.bounds.maxY - window.safeAreaInsets.bottom
        // Count only the bottom safe-area portion actually covered by this table.
        return max(0, viewportFrame.maxY - safeAreaBottomY)
    }

    private func navigationBarHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
        visibleNavigationBars(from: window.rootViewController).reduce(0) { currentHeight, navigationBar in
            guard !navigationBar.isHidden else {
                return currentHeight
            }

            let navigationBarFrame = navigationBar.convert(navigationBar.bounds, to: window)
            // The table opts out of automatic inset adjustment, so visible nav bars
            // have to be included here instead of relying on UIKit.
            return max(currentHeight, navigationBarFrame.maxY - viewportFrame.minY)
        }
    }

    private func visibleNavigationBars(from rootViewController: UIViewController?) -> [UINavigationBar] {
        var navigationBars: [UINavigationBar] = []
        var seenViewControllerIDs: Set<ObjectIdentifier> = []
        var seenNavigationBarIDs: Set<ObjectIdentifier> = []

        func append(_ navigationBar: UINavigationBar) {
            let id = ObjectIdentifier(navigationBar)
            guard !seenNavigationBarIDs.contains(id) else { return }

            seenNavigationBarIDs.insert(id)
            navigationBars.append(navigationBar)
        }

        func visit(_ viewController: UIViewController?) {
            guard let viewController else { return }
            let id = ObjectIdentifier(viewController)
            guard !seenViewControllerIDs.contains(id) else { return }

            seenViewControllerIDs.insert(id)

            // Walk the active controller tree because the table may sit under nested
            // navigation, tab, split, or presented controllers.
            if let navigationController = viewController as? UINavigationController {
                append(navigationController.navigationBar)
                visit(navigationController.visibleViewController)
            }

            if let tabBarController = viewController as? UITabBarController {
                visit(tabBarController.selectedViewController)
            }

            if let splitViewController = viewController as? UISplitViewController {
                splitViewController.viewControllers.forEach(visit)
            }

            viewController.children.forEach(visit)
            visit(viewController.presentedViewController)
        }

        visit(rootViewController)
        return navigationBars
    }

    private func viewportFrame(in window: UIWindow) -> CGRect? {
        guard self.window === window else { return nil }

        if let superview {
            return superview.convert(frame, to: window)
        }

        return convert(CGRect(origin: .zero, size: bounds.size), to: window)
    }
}
