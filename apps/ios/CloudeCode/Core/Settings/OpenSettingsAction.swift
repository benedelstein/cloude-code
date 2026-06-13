import SwiftUI

struct OpenSettingsAction {
    let action: @MainActor () -> Void

    init(_ action: @escaping @MainActor () -> Void) {
        self.action = action
    }

    @MainActor
    func callAsFunction() {
        action()
    }
}

private struct OpenSettingsActionKey: EnvironmentKey {
    static let defaultValue: OpenSettingsAction? = nil
}

extension EnvironmentValues {
    var openSettings: OpenSettingsAction? {
        get { self[OpenSettingsActionKey.self] }
        set { self[OpenSettingsActionKey.self] = newValue }
    }
}
