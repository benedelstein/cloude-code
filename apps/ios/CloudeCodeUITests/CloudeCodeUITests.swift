//
//  CloudeCodeUITests.swift
//  CloudeCodeUITests
//
//  Created by Ben Edelstein on 6/1/26.
//

import XCTest

final class CloudeCodeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testLaunchesSignedOutScreen() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["Cloude Code"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testSignInOpensSystemAuthentication() throws {
        let app = XCUIApplication()
        app.launch()

        let signInButton = app.buttons["Sign in"].firstMatch
        XCTAssertTrue(signInButton.waitForExistence(timeout: 5))

        signInButton.tap()

        XCTAssertTrue(waitForSystemAuthPrompt(), "Expected the system authentication prompt to appear.")
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            XCUIApplication().launch()
        }
    }

    @MainActor
    private func waitForSystemAuthPrompt(timeout: TimeInterval = 10) -> Bool {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let labels = ["Continue", "Continuar"]
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            if labels.contains(where: { springboard.buttons[$0].exists }) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return false
    }
}
