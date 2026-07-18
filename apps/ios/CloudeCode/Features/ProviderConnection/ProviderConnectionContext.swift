import CoreAPI

/// Provider and session details needed to run a native account connection flow.
struct ProviderConnectionContext: Equatable {
    let providerId: ProviderId
    let providerName: String
    let requiresReauth: Bool
    let sessionId: String?
}
