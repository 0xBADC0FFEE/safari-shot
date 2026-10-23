import SwiftUI

// UI test bundles need a target application; the driver itself only controls Safari and SpringBoard.
@main
struct HostApp: App {
    var body: some Scene {
        WindowGroup { Text("safari-shot driver host") }
    }
}
