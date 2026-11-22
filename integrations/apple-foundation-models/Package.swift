// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "KeystoneFoundationModels",
    platforms: [.macOS("27.0")],
    dependencies: [
        .package(url: "https://github.com/apple/foundation-models-utilities.git", exact: "1.1.0")
    ],
    targets: [
        .executableTarget(
            name: "KeystoneFoundationModels",
            dependencies: [
                .product(name: "FoundationModelsUtilities", package: "foundation-models-utilities")
            ]
        )
    ]
)
