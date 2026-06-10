// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "API",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [
        .library(
            name: "API",
            targets: ["API"]
        )
    ],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../Domain"),
        .package(url: "https://github.com/teunlao/swift-ai-sdk.git", from: "0.17.6")
    ],
    targets: [
        .target(
            name: "API",
            dependencies: [
                .product(name: "CoreAPI", package: "CoreAPI"),
                .product(name: "Domain", package: "Domain"),
                .product(name: "SwiftAISDK", package: "swift-ai-sdk")
            ]
        )
    ]
)
