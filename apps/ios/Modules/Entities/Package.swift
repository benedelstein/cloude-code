// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Entities",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(
            name: "Entities",
            targets: ["Entities"]
        )
    ],
    dependencies: [
        .package(path: "../Domain")
    ],
    targets: [
        .target(
            name: "Entities",
            dependencies: [
                .product(name: "Domain", package: "Domain")
            ]
        ),
        .testTarget(
            name: "EntitiesTests",
            dependencies: ["Entities"]
        )
    ]
)
