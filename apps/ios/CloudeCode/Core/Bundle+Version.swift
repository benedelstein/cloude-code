import Foundation

extension Bundle {
    var appVersionShort: String? {
        infoDictionary?["CFBundleShortVersionString"] as? String
    }

    var buildNumber: String? {
        infoDictionary?["CFBundleVersion"] as? String
    }

    var appName: String? {
        infoDictionary?["CFBundleName"] as? String
    }

    var isTestflight: Bool {
        appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
    }
}

extension String {
    func versionCompare(_ otherVersion: String) -> ComparisonResult {
        let delimiter = "."
        var versionComponents = components(separatedBy: delimiter)
        var otherVersionComponents = otherVersion.components(separatedBy: delimiter)
        let countDifference = versionComponents.count - otherVersionComponents.count

        guard countDifference != 0 else {
            return compare(otherVersion, options: .numeric)
        }

        let padding = Array(repeating: "0", count: abs(countDifference))
        if countDifference > 0 {
            otherVersionComponents.append(contentsOf: padding)
        } else {
            versionComponents.append(contentsOf: padding)
        }

        return versionComponents
            .joined(separator: delimiter)
            .compare(otherVersionComponents.joined(separator: delimiter), options: .numeric)
    }
}
