import Observation
import SwiftUI
import UIKit

struct ToastPresentation: Identifiable {
    let id: UUID
    let config: ToastConfig
    let content: AnyView
}

@MainActor
@Observable
final class ToastWindowController {
    private var toastWindow: UIWindow?
    private var dismissTask: Task<Void, Never>?

    private(set) var presentation: ToastPresentation?

    func install(in scene: UIWindowScene? = nil) {
        guard toastWindow == nil else {
            return
        }
        guard let scene = scene ?? activeWindowScene() else {
            return
        }

        let toastWindow = ToastPassThroughWindow(windowScene: scene)
        let toastViewController = UIHostingController(rootView: ToastSceneView(controller: self).themedRoot())
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
        guard toastWindow != nil else {
            return
        }

        let presentation = ToastPresentation(
            id: UUID(),
            config: config,
            content: AnyView(ToastContainerView(content: content))
        )

        dismissTask?.cancel()
        withAnimation(config.insertionAnimation) {
            self.presentation = presentation
        }

        dismissTask = Task { [weak self, id = presentation.id, duration = config.duration] in
            try? await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
            guard !Task.isCancelled else {
                return
            }
            self?.dismiss(id: id)
        }
    }

    func dismiss(id: UUID) {
        guard presentation?.id == id else {
            return
        }
        dismissTask?.cancel()

        let animation = presentation?.config.removalAnimation ?? .default
        withAnimation(animation) {
            presentation = nil
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
