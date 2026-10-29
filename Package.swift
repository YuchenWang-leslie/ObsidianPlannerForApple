// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "ObsidianPlanner",
    platforms: [.macOS(.v14)],
    products: [.library(name: "PlannerCore", targets: ["PlannerCore"]), .executable(name: "ObsidianPlanner", targets: ["ObsidianPlanner"])],
    targets: [.target(name: "PlannerCore"), .executableTarget(name: "ObsidianPlanner", dependencies: ["PlannerCore"]), .testTarget(name: "PlannerCoreTests", dependencies: ["PlannerCore"])])
