# Dependency Injection

This app uses Needle for dependency injection. Needle is a compile-safe dependency injection framework for Swift. It constructs dependencies at build-time via a graph, and creates a generated file `NeedleGenerated.swift` to ensure build-time safety.

For more about needle, see the [Needle documentation](https://needle-di.io/).

The root DI component is defined in `CloudeCode/Core/DI/RootComponent.swift`. This is essentially an app singleton. It only has one child component, `ApplicationComponent`, which is the parent of all other components.

### `shared`

Shared is a special function that makes a dependency instance shared for all uses. For class dependencies, you should probably use `shared`, otherwise each access will get a separate instance.

## ApplicationComponent

This is the parent of all other components. App-level dependencies should be defined here. 

## Dependency Protocol

This is where a component defines what dependencies it needs from its parent. If no parent can satisfy the dependency, xcode will throw a build error.

## Component

This is a class that defines concrete implementations of any objects that are needed for the feature. 

The component also defines any child components that it creates. This is what helps needle construct the dependency graph at build-time.

```swift
final class MyFeatureComponent: Component<MyFeatureDependency> {
    var childComponent: MyChildComponent {
        shared {
            MyChildComponent(parent: self)
        }
    }
}
```

## Builder 

A builder is responsible for constructing the dependency and instantiating the view that uses it. 

```swift
@MainActor
struct MyFeatureBuilder {
    let component: MyFeatureComponent

    func build() -> some View {
        MyFeatureView(viewModel: component.viewModel)
            // pass in other dependencies via environment, eg child builders
            .environment(\.childBuilder, ChildBuilder(component: component.childComponent))
    }
}

extension EnvironmentValues {
    @Entry
    var myFeatureBuilder: MyFeatureBuilder?
}
```

We can inject builders into the environment using the `@Environment` property wrapper.

```swift
struct MyFeatureContainer: View {
    @Environment(\.myFeatureBuilder) private var builder

    var body: some View {
        if let builder {
            builder.build()
        } else {
            ContentUnavailableView("Missing my feature builder", systemImage: "exclamationmark.triangle")
        }
    }
}
```

## Environment DI

SwiftUI itself makes use of @Environment for dependency injection across view trees.

A good pattern to use when injecting dependency logic through view trees is the `Action` pattern -
swiftui uses this for `DismissAction`.

```swift
struct SomeAction {
    // define dependencies the action needs
    let apiClient: APIClient
    let userStore: UserStore

    func callAsFunction() {
        // use dependencies to do something
    }
}

extension EnvironmentValues {
    @Entry
    var someAction: SomeAction? // make it optional, or give a sensible default if one exists
}
```

Callers can use the action like so:

```swift
struct SomeView: View {
    @Environment(\.someAction) private var someAction: SomeAction?

    var body: some View {
        Button("Do something") {
            // you can call the action directly, callAsFunction is a special swift signature
            someAction?()
        }
    }
}
```

You can also use environment with @Observable

```swift
@Observable
final class SomeViewModel {
    let someAction: SomeAction

    init(someAction: SomeAction) {
        self.someAction = someAction
    }
}

struct SomeView: View {
    // NOTE: this will crash at runtime if no parent view has injected it.
    @Environment(SomeViewModel.self) private var viewModel: SomeViewModel

    // ...
}
```