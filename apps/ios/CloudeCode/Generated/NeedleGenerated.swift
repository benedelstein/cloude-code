import API
import Entities
import NeedleFoundation

private let needleDependenciesHash: String? = nil

private func parent1(_ component: NeedleFoundation.Scope) -> NeedleFoundation.Scope {
    component.parent
}

#if !NEEDLE_DYNAMIC

private final class ApplicationDependencyProvider: ApplicationDependency {}

private func applicationDependencyFactory(_ component: NeedleFoundation.Scope) -> AnyObject {
    ApplicationDependencyProvider()
}

private final class HomeDependencyProvider: HomeDependency {
    private let applicationComponent: ApplicationComponent

    init(applicationComponent: ApplicationComponent) {
        self.applicationComponent = applicationComponent
    }

    var greetingAPI: any GreetingAPIProviding {
        applicationComponent.greetingAPI
    }

    var greetingCache: any GreetingCaching {
        applicationComponent.greetingCache
    }
}

private func homeDependencyFactory(_ component: NeedleFoundation.Scope) -> AnyObject {
    HomeDependencyProvider(applicationComponent: parent1(component) as! ApplicationComponent)
}

#endif

private func factoryEmptyDependencyProvider(_ component: NeedleFoundation.Scope) -> AnyObject {
    EmptyDependencyProvider(component: component)
}

private func registerProviderFactory(
    _ componentPath: String,
    _ factory: @escaping (NeedleFoundation.Scope) -> AnyObject
) {
    __DependencyProviderRegistry.instance.registerDependencyProviderFactory(for: componentPath, factory)
}

public func registerProviderFactories() {
    #if !NEEDLE_DYNAMIC
    registerProviderFactory("^->RootComponent", factoryEmptyDependencyProvider)
    registerProviderFactory("^->RootComponent->ApplicationComponent", applicationDependencyFactory)
    registerProviderFactory("^->RootComponent->ApplicationComponent->HomeComponent", homeDependencyFactory)
    #endif
}
