# Feature Development

If you are developing a new feature (eg a new screen or view), it should be placed in the `Features/` folder.

Each feature should be wired up using Needle.

Each feature usually has one or more views, and each view should have its own view model.
Use MVVM as the default feature shape:

- The view owns layout and user interaction wiring only.
- The view model owns view state, async loading, subscriptions, and other effects.
- The view model should be `@Observable`.
- The view model should expose an explicit `load()` method that the view calls from `onAppear`.
- The view model should expose an explicit `unload()` method that the view calls from `onDisappear`.
- The view model initializer should only assign dependencies and initial values. Do not start network requests, tasks, websocket subscriptions, timers, or other effects from `init`.

The feature needs a DI setup, which involves a `Dependency` and `Component` (see `docs/dependency-injection.md` for more details).

```swift
import NeedleFoundation
import SwiftUI

protocol MyFeatureDependency: Dependency {
    var exhibitAPI: ExhibitAPI { get }
    // more deps inherited here.
}

final class MyFeatureComponent: Component<MyFeatureDependency> {
    @MainActor
    var viewModel: MyFeatureViewModel {
        shared {
            MyFeatureViewModel(exhibitAPI: dependency.exhibitAPI)
        }
    }
}

@Observable
@MainActor
final class MyFeatureViewModel {
    private let exhibitAPI: ExhibitAPI
    private var loadTask: Task<Void, Never>?

    private(set) var isLoading = false
    private(set) var items: [Item] = []

    init(exhibitAPI: ExhibitAPI) {
        self.exhibitAPI = exhibitAPI
    }

    func load() {
        guard loadTask == nil else {
            return
        }

        isLoading = true
        loadTask = Task { [weak self] in
            do {
                let items = try await self?.exhibitAPI.items() ?? []
                self?.items = items
            } catch {
                // Store user-facing error state here.
            }
            self?.isLoading = false
        }
    }

    func unload() {
        loadTask?.cancel()
        loadTask = nil
    }
}

struct MyFeatureContainer: View {
    let component: MyFeatureComponent

    var body: some View {
        MyFeatureView(viewModel: component.viewModel)
    }
}

struct MyFeatureView: View {
    @Bindable var viewModel: MyFeatureViewModel

    var body: some View {
        List(viewModel.items) { item in
            Text(item.title)
        }
        .overlay {
            if viewModel.isLoading {
                ProgressView()
            }
        }
        .onAppear {
            viewModel.load()
        }
        .onDisappear {
            viewModel.unload()
        }
    }
}
```
