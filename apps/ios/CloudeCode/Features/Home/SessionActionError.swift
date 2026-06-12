import Foundation

enum SessionActionError: LocalizedError {
    case invalidSessionID

    var errorDescription: String? {
        switch self {
        case .invalidSessionID:
            "Invalid session ID."
        }
    }
}
