import UIKit

final class LayoutReportingCollectionView: UICollectionView {
    struct KeyboardTransition {
        let startTime: TimeInterval
        let duration: TimeInterval
        let options: UIView.AnimationOptions

        var remainingDuration: TimeInterval {
            max(0, duration - (ProcessInfo.processInfo.systemUptime - startTime))
        }
    }

    var onLayoutSubviews: ((LayoutReportingCollectionView) -> Void)?
    private(set) var pendingKeyboardTransition: KeyboardTransition?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayoutSubviews?(self)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updateKeyboardObservers()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

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

    func clearPendingKeyboardTransition() {
        pendingKeyboardTransition = nil
    }

    @objc
    private func keyboardFrameWillChange(_ notification: Notification) {
        guard let window,
              let screenFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
            return
        }

        let keyboardFrameInWindow = window.convert(screenFrame, from: nil)
        let keyboardTransition = keyboardTransition(from: notification)
        pendingKeyboardTransition = keyboardTransition
        print(
            "xx keyboard frame screen=\(screenFrame) " +
                "window=\(keyboardFrameInWindow) " +
                "windowBounds=\(window.bounds) " +
                "duration=\(keyboardTransition.duration) " +
                "remainingDuration=\(keyboardTransition.remainingDuration)"
        )
        setNeedsLayout()
    }

    @objc
    private func keyboardWillHide(_ notification: Notification) {
        pendingKeyboardTransition = keyboardTransition(from: notification)
        setNeedsLayout()
    }

    private func updateKeyboardObservers() {
        NotificationCenter.default.removeObserver(
            self,
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
        NotificationCenter.default.removeObserver(
            self,
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
        pendingKeyboardTransition = nil

        guard window != nil else { return }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardFrameWillChange(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillHide(_:)),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
    }

    private func keyboardTransition(from notification: Notification) -> KeyboardTransition {
        KeyboardTransition(
            startTime: ProcessInfo.processInfo.systemUptime,
            duration: keyboardAnimationDuration(from: notification),
            options: keyboardAnimationOptions(from: notification)
        )
    }

    private func keyboardAnimationDuration(from notification: Notification) -> TimeInterval {
        guard let duration = notification
            .userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber else {
            return 0.25
        }

        return duration.doubleValue
    }

    private func keyboardAnimationOptions(from notification: Notification) -> UIView.AnimationOptions {
        let curveRawValue = (
            notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? NSNumber
        )?.uintValue ?? UInt(UIView.AnimationCurve.easeInOut.rawValue)
        let curveOptions = UIView.AnimationOptions(rawValue: curveRawValue << 16)

        return [.beginFromCurrentState, .allowUserInteraction, .layoutSubviews, curveOptions]
    }

    private func safeAreaTopHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
        max(0, window.safeAreaInsets.top - viewportFrame.minY)
    }

    private func safeAreaBottomHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
        let safeAreaBottomY = window.bounds.maxY - window.safeAreaInsets.bottom
        return max(0, viewportFrame.maxY - safeAreaBottomY)
    }

    private func navigationBarHeight(in window: UIWindow, viewportFrame: CGRect) -> CGFloat {
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
