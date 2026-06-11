import NeedleFoundation

final class RootComponent: BootstrapComponent, @unchecked Sendable {
    static let shared = RootComponent()

    var applicationComponent: ApplicationComponent {
        shared {
            ApplicationComponent(parent: self)
        }
    }
}
