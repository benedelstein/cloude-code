import Foundation

/// Generic JSON API client — pure transport. Endpoints are described by
/// `APIRequest` values; `fetch` encodes the typed body and decodes the typed
/// response. Auth is a per-API concern: authed APIs attach their own
/// `Authorization` header via `APIRequest.headers`.
public struct APIClient: Sendable {
    private let baseURL: URL
    private let urlSession: URLSession
    private let defaultHeaders: [String: String]

    public init(
        baseURL: URL,
        urlSession: URLSession = .shared,
        defaultHeaders: [String: String] = ["Accept": "application/json"]
    ) {
        self.baseURL = baseURL
        self.urlSession = urlSession
        self.defaultHeaders = defaultHeaders
    }

    public func fetch<R: APIRequest>(_ request: R) async throws -> R.Response {
        let urlRequest = try makeURLRequest(for: request)
        let (data, response) = try await urlSession.data(for: urlRequest)
        try validate(response: response, data: data)

        let decoder = request.responseDecoder ?? JSONDecoder()
        do {
            if data.isEmpty, R.Response.self == EmptyResponse.self {
                guard let response = EmptyResponse() as? R.Response else {
                    throw APIError.invalidResponse
                }
                return response
            }
            return try decoder.decode(R.Response.self, from: data)
        } catch {
            throw APIError.decodingFailed(error)
        }
    }

    func fetchMultipart<R: MultipartAPIRequest>(_ request: R) async throws -> R.Response {
        let urlRequest = try makeMultipartURLRequest(for: request)
        let (data, response) = try await urlSession.data(for: urlRequest)
        try validate(response: response, data: data)

        do {
            return try JSONDecoder().decode(R.Response.self, from: data)
        } catch {
            throw APIError.decodingFailed(error)
        }
    }

    private func makeURLRequest<R: APIRequest>(for request: R) throws -> URLRequest {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: true) else {
            throw APIError.invalidURL
        }
        components.path = components.path
            .appending("/")
            .appending(request.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        components.queryItems = request.queryItems.isEmpty ? nil : request.queryItems

        guard let url = components.url else {
            throw APIError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method.rawValue
        if let body = request.body, request.method != .get {
            urlRequest.httpBody = try JSONEncoder().encode(body)
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        for (key, value) in defaultHeaders {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        // Per-request headers win over defaults.
        for (key, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        return urlRequest
    }

    private func makeMultipartURLRequest<R: MultipartAPIRequest>(for request: R) throws -> URLRequest {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: true) else {
            throw APIError.invalidURL
        }
        components.path = components.path
            .appending("/")
            .appending(request.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        components.queryItems = request.queryItems.isEmpty ? nil : request.queryItems

        guard let url = components.url else {
            throw APIError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method.rawValue

        for (key, value) in defaultHeaders {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        for (key, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        urlRequest.httpBody = MultipartFormDataEncoder.encode(parts: request.parts, boundary: boundary)
        // The boundary is part of the wire format: the header tells the server
        // which byte marker separates fields inside the body we just encoded.
        urlRequest.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        return urlRequest
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            let serverError = try? JSONDecoder().decode(APIErrorResponse.self, from: data)
            if httpResponse.statusCode == 401 {
                throw APIError.unauthenticated
            }
            throw APIError.httpError(
                statusCode: httpResponse.statusCode,
                code: serverError?.code,
                message: serverError?.error
            )
        }
    }
}
