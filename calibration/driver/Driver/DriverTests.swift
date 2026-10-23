import XCTest

// Long-lived UI test that executes gesture commands written by the host into SIMDRIVER_DIR.
// The simulator shares the host filesystem, so a plain file mailbox is enough.
final class DriverTests: XCTestCase {
    struct Command: Decodable {
        let id: String
        let steps: [Step]
    }

    struct Step: Decodable {
        let action: String
        let app: String?
        let x: Double?
        let y: Double?
        let toX: Double?
        let toY: Double?
        let duration: Double?
        let hold: Double?
        let velocity: Double?
        let label: String?
        let timeout: Double?
    }

    private let pollInterval: TimeInterval = 0.05
    private let sessionLimit: TimeInterval = 4 * 60 * 60

    func testServeCommands() throws {
        let dir = try XCTUnwrap(ProcessInfo.processInfo.environment["SIMDRIVER_DIR"], "SIMDRIVER_DIR is not set")
        let commandURL = URL(fileURLWithPath: dir).appendingPathComponent("command.json")
        let readyURL = URL(fileURLWithPath: dir).appendingPathComponent("ready")
        try Data().write(to: readyURL)
        let deadline = Date().addingTimeInterval(sessionLimit)
        var lastId = ""
        while Date() < deadline {
            guard let data = try? Data(contentsOf: commandURL),
                  let command = try? JSONDecoder().decode(Command.self, from: data),
                  command.id != lastId else {
                Thread.sleep(forTimeInterval: pollInterval)
                continue
            }
            lastId = command.id
            var failures: [String] = []
            for step in command.steps {
                if step.action == "quit" { return }
                do { try perform(step) } catch { failures.append("\(step.action): \(error)") }
            }
            let result: [String: Any] = ["id": command.id, "errors": failures]
            try JSONSerialization.data(withJSONObject: result).write(to: URL(fileURLWithPath: dir).appendingPathComponent("done-\(command.id).json"))
        }
    }

    private func application(_ name: String?) -> XCUIApplication {
        switch name {
        case nil, "safari": return XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        case "springboard": return XCUIApplication(bundleIdentifier: "com.apple.springboard")
        case let bundleId?: return XCUIApplication(bundleIdentifier: bundleId)
        }
    }

    private func point(_ app: XCUIApplication, _ x: Double?, _ y: Double?) -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x ?? 0, dy: y ?? 0))
    }

    // Safari's Tabs button menu offers "Close All N Tabs", then asks to confirm with a button of the same label.
    private func closeAllTabs(_ app: XCUIApplication) throws {
        let tabsButton = app.buttons["TabOverviewButton"]
        guard tabsButton.waitForExistence(timeout: 5) else { throw StepError(description: "Tabs button not found") }
        tabsButton.press(forDuration: 1.0)
        let closeAll = NSPredicate(format: "label BEGINSWITH 'Close All'")
        let menuItem = app.descendants(matching: .any).matching(closeAll).firstMatch
        guard menuItem.waitForExistence(timeout: 5) else {
            let labels = app.buttons.allElementsBoundByIndex.map(\.label).joined(separator: ", ")
            throw StepError(description: "no Close All item after long-pressing Tabs; buttons: \(labels)")
        }
        menuItem.tap()
        let confirm = app.buttons.matching(closeAll).firstMatch
        if confirm.waitForExistence(timeout: 3) { confirm.tap() }
    }

    struct StepError: Error, CustomStringConvertible {
        let description: String
    }

    private func perform(_ step: Step) throws {
        let app = application(step.app)
        switch step.action {
        case "activate":
            app.activate()
        case "tap":
            point(app, step.x, step.y).tap()
        case "drag":
            let from = point(app, step.x, step.y)
            let to = point(app, step.toX, step.toY)
            from.press(
                forDuration: step.duration ?? 0.05,
                thenDragTo: to,
                withVelocity: XCUIGestureVelocity(CGFloat(step.velocity ?? 1500)),
                thenHoldForDuration: step.hold ?? 0
            )
        case "swipe":
            let webView = app.webViews.firstMatch
            let velocity = XCUIGestureVelocity(CGFloat(step.velocity ?? 800))
            if step.label == "down" { webView.swipeDown(velocity: velocity) } else { webView.swipeUp(velocity: velocity) }
        case "tapLabel":
            let label = try XCTUnwrap(step.label)
            let element = app.descendants(matching: .any)[label].firstMatch
            guard element.waitForExistence(timeout: step.timeout ?? 5) else {
                throw StepError(description: "element '\(label)' not found")
            }
            element.tap()
        case "closeAllTabs":
            try closeAllTabs(app)
        case "typeText":
            app.typeText(try XCTUnwrap(step.label))
        case "dumpTree":
            let target = URL(fileURLWithPath: try XCTUnwrap(step.label))
            try app.debugDescription.write(to: target, atomically: true, encoding: .utf8)
        case "orient":
            XCUIDevice.shared.orientation = step.label == "landscape" ? .landscapeLeft : .portrait
        case "sleep":
            Thread.sleep(forTimeInterval: step.duration ?? 1)
        default:
            throw StepError(description: "unknown action \(step.action)")
        }
    }
}
