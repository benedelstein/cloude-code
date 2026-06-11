import SwiftUI

struct RootView: View {
    private let component: ApplicationComponent

    init(component: ApplicationComponent) {
        self.component = component
    }

    var body: some View {
        HomeContainer()
            .environment(\.homeBuilder, HomeBuilder(component: component.homeComponent))
            .themedRoot()
    }
}
