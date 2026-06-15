import CoreAPI
import Foundation

private struct RegisterFcmToken: APIRequest {
    typealias Body = RegisterFcmTokenRequest
    typealias Response = RegisterFcmTokenResponse

    var body: RegisterFcmTokenRequest?
    var headers: [String: String]

    var path: String { "notifications/fcm-tokens" }
    var method: HTTPMethod { .post }
}

public protocol NotificationsAPIProviding: Sendable {
    func registerFcmToken(deviceId: String, token: String) async throws
}

public struct NotificationsAPI: NotificationsAPIProviding {
    private let client: APIClient
    private let tokenProvider: any AuthTokenProviding

    public init(client: APIClient, tokenProvider: any AuthTokenProviding) {
        self.client = client
        self.tokenProvider = tokenProvider
    }

    public func registerFcmToken(deviceId: String, token: String) async throws {
        _ = try await client.fetch(RegisterFcmToken(
            body: RegisterFcmTokenRequest(
                deviceId: deviceId,
                token: token,
                platform: .ios
            ),
            headers: tokenProvider.bearerHeaders()
        ))
    }
}
