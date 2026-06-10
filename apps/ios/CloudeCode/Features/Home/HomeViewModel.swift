import API
import Entities
import Foundation

@MainActor
@Observable
final class HomeViewModel {
    private let greetingAPI: any GreetingAPIProviding
    private let greetingCache: any GreetingCaching

    private(set) var greeting = "Loading..."
    private(set) var errorMessage: String?
    private(set) var isLoading = false

    init(greetingAPI: any GreetingAPIProviding, greetingCache: any GreetingCaching) {
        self.greetingAPI = greetingAPI
        self.greetingCache = greetingCache
    }

    func loadGreeting() {
        guard !isLoading else {
            return
        }

        isLoading = true
        errorMessage = nil

        Task {
            do {
                if let cachedGreeting = await greetingCache.greeting() {
                    Logger.debug("Loaded cached greeting")
                    greeting = cachedGreeting
                }

                let freshGreeting = try await greetingAPI.fetchGreeting()
                await greetingCache.storeGreeting(freshGreeting)
                greeting = freshGreeting
            } catch {
                Logger.error(error)
                errorMessage = error.localizedDescription
            }

            isLoading = false
        }
    }
}
