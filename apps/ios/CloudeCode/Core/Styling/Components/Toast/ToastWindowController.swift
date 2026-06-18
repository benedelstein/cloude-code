import SwiftUI
import UIKit

@MainActor
final class ToastWindowController {
    private var toastWindow: UIWindow?

    func install(in scene: UIWindowScene? = nil) {
        guard toastWindow == nil else {
            return
        }
        guard let scene = scene ?? activeWindowScene() else {
            return
        }

        let toastWindow = ToastPassThroughWindow(windowScene: scene)
        let toastViewController = UIHostingController(rootView: ToastSceneView().themedRoot())
        toastViewController.view.backgroundColor = .clear
        toastWindow.rootViewController = toastViewController
        toastWindow.isHidden = false
        toastWindow.windowLevel = .alert
        self.toastWindow = toastWindow
    }

    func show<Content: View>(
        _ config: ToastConfig,
        content: @escaping () -> Content
    ) {
        install()
        guard let toastWindow else {
            return
        }

        toastWindow.showToast(config) { [weak toastWindow] in
            ToastContainerView(content: content)
                .padding(.top, toastWindow?.safeAreaInsets.top ?? 0)
        }
    }

    private func activeWindowScene() -> UIWindowScene? {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }

        return scenes.first { $0.activationState == .foregroundActive }
            ?? scenes.first { $0.activationState == .foregroundInactive }
            ?? scenes.first
    }
}
