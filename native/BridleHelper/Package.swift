// swift-tools-version: 6.2
import PackageDescription

// bridle-helper: the Apple frameworks Electron can't reach (NaturalLanguage, Vision, Quick Look, Speech),
// as one long-lived process speaking JSON lines on stdin/stdout. See main.swift for the protocol.
let package = Package(
    name: "BridleHelper",
    platforms: [.macOS(.v26)],
    targets: [
        .executableTarget(name: "bridle-helper", swiftSettings: [.swiftLanguageMode(.v5)]),
        // The notch island (src/main/notch.ts): its own process, as it runs an AppKit app.
        .executableTarget(name: "bridle-notch", swiftSettings: [.swiftLanguageMode(.v5)])
    ]
)
