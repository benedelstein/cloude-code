import Domain
import UIKit

final class LayoutReportingCollectionView: UICollectionView {
    /// Called after UIKit completes this collection view's layout pass.
    var onLayoutSubviews: ((LayoutReportingCollectionView) -> Void)?
    /// Most recent keyboard transition waiting to be consumed by the transcript coordinator.
    private(set) var pendingKeyboardTransition: KeyboardTransition?
    private let keyboardTransitionObserver: KeyboardTransitionObserving

    /// Creates a collection view that reports layout passes and keyboard transitions.
    init(
        frame: CGRect,
        collectionViewLayout layout: UICollectionViewLayout,
        keyboardTransitionObserver: KeyboardTransitionObserving = NotificationKeyboardTransitionObserver()
    ) {
        self.keyboardTransitionObserver = keyboardTransitionObserver
        super.init(frame: frame, collectionViewLayout: layout)
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

    /// Returns the insets needed when this view overlaps safe areas or visible navigation bars.
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
        pendingKeyboardTransition = transition
        setNeedsLayout()
    }

    private var distanceFromBottom: CGFloat {
        let visibleBottomY = contentOffset.y + bounds.height - adjustedContentInset.bottom
        return contentSize.height - visibleBottomY
    }

    private func format(_ value: CGFloat) -> String {
        String(format: "%.2f", Double(value))
    }

    private func safeAreaTopHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
        // Add only the top safe-area portion that overlaps this view's frame.
        max(0, window.safeAreaInsets.top - viewportFrame.minY)
    }

    private func safeAreaBottomHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
        // Add only the bottom safe-area portion that overlaps this view's frame.
        let safeAreaBottomY = window.bounds.maxY - window.safeAreaInsets.bottom
        return max(0, viewportFrame.maxY - safeAreaBottomY)
    }

    private func navigationBarHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
        // Add visible navigation-bar overlap because this view opts out of automatic inset adjustment.
        visibleNavigationBars(from: window.rootViewController).reduce(0) { currentHeight, navigationBar in
            guard !navigationBar.isHidden else {
                return currentHeight
            }

            let navigationBarFrame = navigationBar.convert(navigationBar.bounds, to: window)
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

        // recursively look for a navigation bar in view, starting from root
        visit(rootViewController)
        return navigationBars
    }

    // return the frame of the view in global coordinates
    private func viewportFrame(in window: UIWindow) -> CGRect? {
        guard self.window === window else { return nil }

        if let superview {
            return superview.convert(frame, to: window)
        }

        return convert(CGRect(origin: .zero, size: bounds.size), to: window)
    }
}
