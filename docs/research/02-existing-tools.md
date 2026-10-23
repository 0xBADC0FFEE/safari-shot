# Existing tools for previewing iOS Safari "beyond-viewport" chrome (no simulator)

Researched 2026-10-23. Bottom line: **no tool found simulates Safari's toolbar or status-bar tint** (the iOS 15+ theme-color tint, or the iOS 26 Liquid Glass tint sampled from body/fixed elements). Existing tools cover only safe-area insets, device frames, small-viewport units, and static meta/manifest checks.

## Ranked

| # | Tool | What it shows | Tint sim? | Status / license | Headless for an agent? |
|---|------|---------------|-----------|------------------|-------------------|
| 1 | Chrome CDP `Emulation.setSafeAreaInsetsOverride` ([selenium docs](https://www.selenium.dev/selenium/docs/api/dotnet/webdriver/OpenQA.Selenium.DevTools.V150.Emulation.SetSafeAreaInsetsOverrideCommandSettings.html), [scrapfly CDP ref](https://scrapfly.io/docs/cloud-browser-api/cdp-reference/Emulation)) | Makes `env(safe-area-inset-*)` return real values in Chromium | No | Experimental CDP command, roughly Chrome 136+; BSD | **Yes**, via Playwright/Puppeteer `newCDPSession`. This is the best primitive for building a tool. |
| 2 | Polypane 26+ ([blog](https://polypane.app/blog/polypane-26-accurate-device-emulation-with-safe-area-and-small-viewport-units/)) | Per-device safe-area insets shown as blue bands; `svh` emulation with the address-bar area marked in pink | No (theme-color and status bar not mentioned) | Commercial (14-day trial), actively maintained | No, it is a desktop GUI app |
| 3 | Progressier iOS Safe Area Simulator ([link](https://progressier.com/ios-safe-area-simulator)) | Notch and Dynamic Island overlay, plus generated safe-area CSS | No | Free web tool, proprietary | No |
| 4 | bleedblend ([README](https://cdn.jsdelivr.net/npm/bleedblend@2.3.0/README.md)) | Runtime library that *steers* Safari 26 tinting (edge colors, overscroll) | No; it only affects real Safari | MIT, npm, current | Not a preview tool. Useful as a reference for the tinting rules. |
| 5 | Static checks: frontendchecklist rules ([manifest](https://frontendchecklist.io/rules/html/web-app-manifest), [installability](https://frontendchecklist.io/rules/html/pwa-installability)), [metricspot](https://metricspot.com/docs/web-app-manifest/), PWABuilder | Check that the manifest and meta tags (`theme_color`) are present | No | Varies | Partly. The checks are simple enough to reimplement as a lint step. Lighthouse's old "themed omnibox" audit was dropped when the PWA category was removed in v12 (from memory, not verified here). |
| 6 | Chrome DevTools device frames, Responsively App, Sizzy | Device bezels and viewport sizes | No | Responsively is open source (AGPL); Sizzy is commercial | Frames only. They don't model safe areas or toolbars. (From general knowledge; no current docs fetched.) |
| 7 | BrowserStack/LambdaTest real-device screenshots | Real iOS Safari, so the tint is real | Real, not simulated | Paid | Yes, through an API, but it needs a cloud account |

## Tinting ground truth (for anyone building a simulator)
- In iOS 26 the tint comes from the `body` background. A visible fixed-position element's background overrides it at the top or bottom edge. In 26.0 and 26.1 the `theme-color` meta was effectively ignored ([Ben Frain](https://benfrain.com/ios26-safari-theme-color-tab-tinting-with-fixed-position-elements/); [WebKit 302272](https://bugs.webkit.org/show_bug.cgi?id=302272), duplicate of 300965, now resolved).
- `env(safe-area-inset-*)` needs `viewport-fit=cover`.
- Background on the pre-26 theme-color tint: [useyourloaf](https://useyourloaf.com/blog/safari-15-theme-color).

## Honest gap
Nothing found renders a predicted Safari status bar, URL bar or toolbar tint, or overscroll color, around a page. The nearest approach would combine CDP safe-area overrides, a device-frame overlay, and a heuristic that samples body and fixed-element backgrounds at the edges (the rules bleedblend encodes). Only real devices or cloud real-device services show the true result.
