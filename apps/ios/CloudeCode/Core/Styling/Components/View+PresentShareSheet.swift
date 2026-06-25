import SwiftUI
import UIKit

extension View {
    @MainActor func presentShareSheet(activityItems: [Any]) {
        UIApplication.shared.presentShareSheet(activityItems)
    }
}

extension UIApplication {
    @MainActor func presentShareSheet(_ activityItems: [Any]) {
        let activityController = UIActivityViewController(
            activityItems: activityItems,
            applicationActivities: nil
        )

        guard let topController = activeKeyWindow?.rootViewController?.topMostPresentedViewController else {
            return
        }

        activityController.popoverPresentationController?.sourceView = topController.view
        activityController.popoverPresentationController?.sourceRect = CGRect(
            x: topController.view.bounds.midX,
            y: topController.view.bounds.midY,
            width: 1,
            height: 1
        )
        topController.present(activityController, animated: true)
    }
}

private extension UIViewController {
    var topMostPresentedViewController: UIViewController {
        if let presentedViewController, !presentedViewController.isBeingDismissed {
            return presentedViewController.topMostPresentedViewController
        }

        if let navigationController = self as? UINavigationController {
            return navigationController.visibleViewController?.topMostPresentedViewController ?? navigationController
        }

        if let tabBarController = self as? UITabBarController {
            return tabBarController.selectedViewController?.topMostPresentedViewController ?? tabBarController
        }

        return self
    }
}
