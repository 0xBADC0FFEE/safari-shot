# 04 - Real iOS Safari screenshots with browser chrome (no local Mac)

Goal: get screenshots of real iOS Safari, including the status bar and the Safari toolbars, from an automated agent with no local Mac or iOS Simulator.

## Summary ranking (cheapest first)
1. **GitHub Actions `macos-*` runner with iOS Simulator + `xcrun simctl io booted screenshot`**: free on standard runners for public repos. Simulator screenshots capture the whole device screen, so they include the status bar and Safari's address bar and tab bar, but no device bezel. This is the best CI fallback.
2. **Appium (XCUITest driver) on a cloud real device** (BrowserStack Automate, LambdaTest, Sauce Labs, AWS Device Farm): the driver screenshot of iOS Safari is full-screen and includes the status bar and Safari panels. These services are paid, with free trials only.
3. **BrowserStack Screenshots product / API**: runs on real devices, but the docs don't say whether the output is cropped to the viewport. Treat it as unverified.
4. **Cloud Mac rental** (Scaleway Mac mini, MacStadium, AWS EC2 mac): works fine with simctl, but the minimum billing period makes it the most expensive option for occasional use.
5. **Playwright WebKit iOS device emulation**: does NOT draw a status bar or toolbars. It only sets the viewport, UA, DPR and touch, and it is WebKit on Linux rather than iOS Safari. Not usable for this goal.

## Details

### GitHub Actions macOS + Simulator
- Standard GitHub-hosted runners are free and unlimited for public repositories. Private repos are billed at about **$0.062/min** for standard macOS (3-4 core M1/Intel). Larger macOS runners cost $0.077 to $0.102/min and are not free for public repos. Source: https://docs.github.com/en/enterprise-cloud@latest/billing/reference/actions-runner-pricing
- Recipe: `xcrun simctl boot "iPhone 16"`, then `xcrun simctl openurl booted https://...`, then `xcrun simctl io booted screenshot out.png`. For a clean status bar, run `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100` first. simctl io screenshots capture the full simulated display, so Safari UI is included. Reference: `xcrun simctl help io` / https://developer.apple.com/documentation/xcode/running-your-app-in-simulator-or-on-a-device
- Timing (rough, from experience; not measured here): runner queue plus startup takes about 1 minute. The first simulator boot takes about 30 to 90 s on a cold image, and the first Safari launch adds a few seconds. Budget 2 to 4 minutes per job, or about $0.12 to $0.25 per run on a private repo.
- Caveat: this is a simulator, not a real device. The Safari chrome matches the iOS version, but rendering can differ slightly from hardware.

### Appium / XCUITest full-screen screenshot
- On iOS Safari, Appium's screenshot captures the entire screen: status bar (Wi-Fi, clock, battery) plus Safari's top and bottom panels. Android Chrome, by contrast, gives only the browser area. Source: https://discuss.appium.io/t/screenshot-on-ios-safari-browser-only/27250
- Command reference: https://appium.readthedocs.io/en/latest/en/commands/session/screenshot/ and the driver source https://app.unpkg.com/appium-xcuitest-driver@11.17.3/files/lib/commands/general.ts
- This works on any cloud that exposes Appium/XCUITest against real iPhones: BrowserStack Automate/App Automate, LambdaTest Real Device, Sauce Labs RDC, and AWS Device Farm (about $0.17 per device-minute metered, with a 1,000-minute one-time free trial; https://aws.amazon.com/device-farm/pricing/). Prices on the other vendors change often, so check the vendor pages. All are paid plans with time-limited trials.

### BrowserStack Screenshots
- Uses real mobile devices (emulators are deprecated): https://www.browserstack.com/support/faq/screenshots/features-screenshots/do-you-provide-real-mobile-devices-for-taking-screenshots
- REST API: https://browserstack.com/screenshots/api
- Whether the output includes Safari chrome is not documented. Historically the output looks like viewport/page captures. Verify with a trial before relying on it.
- iOS real-device sessions on BrowserStack can show a red screen-recording indicator in the status bar: https://www.browserstack.com/support/faq/app-live/test-session-app-live/why-do-i-see-a-screen-broadcast-recording-icon-red-dot-on-the-notification-bar-while-testing-on-ios-devices-2

### Cloud Mac rental
- Scaleway Apple silicon (https://www.scaleway.com/en/hello-m1/), MacStadium (https://www.macstadium.com/), AWS EC2 Mac (24-hour minimum allocation, https://aws.amazon.com/ec2/instance-types/mac/). Apple's macOS license imposes the 24-hour minimum, so these suit persistent use, not one-off shots.

### Playwright WebKit
- Device descriptors (`devices['iPhone 15']`) set viewport, userAgent, deviceScaleFactor, isMobile and hasTouch only. There is no status bar or toolbar rendering. https://playwright.dev/docs/emulation
- An agent could composite fake chrome onto the image, but that would not count as a real Safari screenshot.

## Recommendation
Use a GitHub Actions macOS job on a public repo with the simulator and `simctl io screenshot` plus a status_bar override. It costs $0 and includes real Safari chrome. Escalate to Appium on AWS Device Farm or BrowserStack only if real-hardware fidelity is required.
