import SwiftUI

struct ShowToastAction {
    let windowController: ToastWindowController

    @MainActor
    func callAsFunction(
        _ config: ToastConfig = .cloudeDefault,
        title: LocalizedStringResource,
        subtitle: LocalizedStringResource? = nil,
        icon: Image? = nil
    ) {
        callAsFunction(config) {
            ToastDefaultContentView(
                title: Text(title),
                subtitle: subtitle.map { Text($0) },
                icon: icon
            )
        }
    }

    @MainActor
    func callAsFunction(
        _ config: ToastConfig = .cloudeDefault,
        verbatimTitle: String,
        verbatimSubtitle: String? = nil,
        icon: Image? = nil
    ) {
        callAsFunction(config) {
            ToastDefaultContentView(
                title: Text(verbatim: verbatimTitle),
                subtitle: verbatimSubtitle.map { Text(verbatim: $0) },
                icon: icon
            )
        }
    }

    @MainActor
    func callAsFunction<Content: View>(
        _ config: ToastConfig = .cloudeDefault,
        content: @escaping () -> Content
    ) {
        windowController.show(config, content: content)
    }
}

extension EnvironmentValues {
    @Entry
    var showToast: ShowToastAction?
}
