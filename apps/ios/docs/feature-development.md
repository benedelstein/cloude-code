# Feature Development

If you are developing a new feature (eg a new screen or view), it should be placed in the `Features/` folder.

Each feature should be wired up using Needle.

Each feature usually has a store and a view. 
The store is like a view model, handling requests and storing state. 

The feature needs a DI setup, which involves a `Dependency` and `Component` (see `docs/dependency-injection.md` for more details).

```swift
import NeedleFoundation

protocol MyFeatureDependency: Dependency {
    var exhibitAPI: ExhibitAPI { get }
    // more deps inherited here.
}

final class MyFeatureComponent: Component<MyFeatureDependency> {
    var someDependency: SomeDependency {
        // construct your own dependencies here, using dependencies if needed
        // e.g. shared { MyFeatureStore(dependency.someDependency) }
    }
}

@Observable
@MemberwiseInit()
final class MyFeatureBuilder {
    let component: () -> MyFeatureComponent

    @MainActor func build(...) -> some View {
        // construct dependencies
        let component = component()
        let store = MyFeatureStore(...) // inject deps
        return MyFeatureview(store: store)
    }
}
struct MyFeatureContainer: View {
    @Environment(UserProfileBuilder.self) var builder: MyFeatureBuilder
    let user: User
    let isModal: Bool
    
    var body: some View {
        builder.build(user: user, isModal: isModal)
    }
}

// inject via the .evironment(UserProfile.self, ...) in a parent view
```
