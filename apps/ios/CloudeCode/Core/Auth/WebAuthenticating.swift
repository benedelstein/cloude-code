import AuthenticationServices
import Foundation
import SwiftUI

/// The one system web-auth presentation a sign-in uses.
///
/// `SessionStore` depends on this rather than `WebAuthenticationSession`
/// directly so the callback-matching and dismissal-recovery behavior can be
/// exercised without presenting a real browser.
@MainActor
protocol WebAuthenticating {
    func authenticate(using url: URL, callbackURLScheme: String) async throws -> URL
}

extension WebAuthenticationSession: WebAuthenticating {
    // The SDK method has a defaulted `preferredBrowserSession`, which does not
    // satisfy the two-parameter requirement on its own.
    func authenticate(using url: URL, callbackURLScheme: String) async throws -> URL {
        try await authenticate(
            using: url,
            callbackURLScheme: callbackURLScheme,
            preferredBrowserSession: nil
        )
    }
}
