public protocol GreetingCaching: Sendable {
    func greeting() async -> String?
    func storeGreeting(_ greeting: String) async
}

public actor GreetingCache: GreetingCaching {
    private var cachedGreeting: String?

    public init() {}

    public func greeting() async -> String? {
        cachedGreeting
    }

    public func storeGreeting(_ greeting: String) async {
        cachedGreeting = greeting
    }
}
