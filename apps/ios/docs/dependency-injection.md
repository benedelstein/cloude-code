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
    }
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