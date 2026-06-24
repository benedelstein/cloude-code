import API
import Entities
import Foundation
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

    var sessionsAPI: any SessionsAPIProviding {
        applicationComponent.sessionsAPI
    }

    @MainActor
    var notificationHandler: NotificationHandler {
        applicationComponent.notificationHandler
    }

    @MainActor
    var sessionSummaryStore: SessionSummaryStore {
        applicationComponent.sessionSummaryStore
    }

    var cache: Cache {
        applicationComponent.cache
    }

    var userSessionsSocket: UserSessionsSocket {
        applicationComponent.userSessionsSocket
    }
}

private func homeDependencyFactory(_ component: NeedleFoundation.Scope) -> AnyObject {
    HomeDependencyProvider(applicationComponent: parent1(component) as! ApplicationComponent)
}

private final class AgentSessionDependencyProvider: AgentSessionDependency {
    private let applicationComponent: ApplicationComponent
    private let homeComponent: HomeComponent

    init(applicationComponent: ApplicationComponent, homeComponent: HomeComponent) {
        self.applicationComponent = applicationComponent
        self.homeComponent = homeComponent
    }

    func makeSessionSocket(sessionId: String) -> SessionSocket {
        applicationComponent.makeSessionSocket(sessionId: sessionId)
    }

    @MainActor
    var sessionMessageStore: SessionMessageStore {
        homeComponent.sessionMessageStore
    }
}

private func agentSessionDependencyFactory(_ component: NeedleFoundation.Scope) -> AnyObject {
    AgentSessionDependencyProvider(
        applicationComponent: parent1(parent1(component)) as! ApplicationComponent,
        homeComponent: parent1(component) as! HomeComponent
    )
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
    registerProviderFactory(
        "^->RootComponent->ApplicationComponent->HomeComponent->AgentSessionComponent",
        agentSessionDependencyFactory
    )
    #endif
}
