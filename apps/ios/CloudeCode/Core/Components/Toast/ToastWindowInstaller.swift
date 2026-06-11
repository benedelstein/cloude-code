import SwiftUI
import UIKit

struct ToastWindowInstaller: UIViewRepresentable {
    let controller: ToastWindowController

    func makeUIView(context: Context) -> ToastSceneReportingView {
        let view = ToastSceneReportingView()
        view.onWindowSceneChange = { [weak controller] scene in
            controller?.install(in: scene)
        }
        return view
    }

    func updateUIView(_ uiView: ToastSceneReportingView, context: Context) {
        uiView.onWindowSceneChange = { [weak controller] scene in
            controller?.install(in: scene)
        }
        uiView.reportWindowScene()
    }
}

final class ToastSceneReportingView: UIView {
    var onWindowSceneChange: ((UIWindowScene?) -> Void)?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        reportWindowScene()
    }

    func reportWindowScene() {
        onWindowSceneChange?(window?.windowScene)
    }
}
