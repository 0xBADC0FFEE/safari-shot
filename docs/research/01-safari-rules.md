# iOS Safari: what paints behind the status bar / URL bar / toolbar (iOS 15 to 26)

Source code was read from WebKit `main` (raw.githubusercontent.com, fetched 2026-10-23). Line numbers drift over time, so search by identifier. Base URL: `https://github.com/WebKit/WebKit/blob/main/Source/`. Shipping Safari may lag `main`.

## 1. Color inputs (WebCore)

### 1.1 theme-color: `Document::themeColor()` / `determineActiveThemeColorMetaElement()`
Source: Source/WebCore/dom/Document.cpp — https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.cpp
- The candidate list is every `<meta>` in the document whose `name` equals "theme-color" (ASCII case-insensitive) and whose `content` parses as a valid color. Candidates are kept in document order.
- The active candidate is the **first** one where `mediaAttributeMatches()` is true. A meta with no `media` attribute always matches.
- If no meta tag wins, WebKit falls back to the manifest `theme_color_dark` when the page uses a dark appearance, and otherwise to the manifest `theme_color`. A meta tag therefore beats the manifest.
- History: Safari 15 added support for `theme-color` in meta tags and the manifest, including `media` for light and dark. On iPhone (compact tab layout) it "changes the Tab Bar and overscroll area background colors in Compact Tab layout": https://webkit.org/blog/11989/new-webkit-features-in-safari-15/
- **iOS 26:** WebKit still parses theme-color and exposes it as `WKWebView.themeColor`. However, developers report that Safari 26's Liquid Glass chrome no longer uses it for tinting. Tinting comes from the page background and from fixed or sticky elements instead: https://bugs.webkit.org/show_bug.cgi?id=301756 and https://benfrain.com/ios26-safari-theme-color-tab-tinting-with-fixed-position-elements/
  - Apple engineer Wenson Hsieh's comment on bug 301756 confirms the background-derived bar is expected behavior. The removal of theme-color support itself is the reporter's belief, not an Apple statement.
  - The Safari 26 release notes do not mention theme-color: https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes.md
  - For a linter: treat theme-color as having **no effect on iOS 26+ Safari tabs**.

### 1.2 Page background, the "under-page" / overscroll color
- `LocalFrameView::documentBackgroundColor()` in Source/WebCore/page/LocalFrameView.cpp — https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/LocalFrameView.cpp
  - It reads the used background-color of `<html>` and of `<body>`.
  - The result is source-over compositing in this order: base view color (white by default), then html, then body.
  - If only one of the two is set, only that one is blended over the base.
  - If neither is set, it returns an invalid color, and `baseBackgroundColor()` is used.
  - Background *images* are ignored.
  - If an element is fullscreen, its color (or its ::backdrop color) replaces or blends with the body color.
- `RenderLayerCompositor::rootBackgroundColorOrTransparencyChanged()` produces `rootExtendedBackgroundColor`, which `Page::pageExtendedBackgroundColor()` returns. This only happens when the `backgroundShouldExtendBeyondPage` setting is on: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderLayerCompositor.cpp and https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Page.cpp
- `WebPageProxy::underPageBackgroundColor()` resolves to the first available of: app override, then pageExtendedBackgroundColor, then the platform default: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/WebPageProxy.cpp
- Apple's documentation for underPageBackgroundColor says it is "visible when the user scrolls beyond the bounds of the page" and is derived "using the background colors of the <html> and <body> elements with the background color of the web view": https://developer.apple.com/tutorials/data/documentation/webkit/wkwebview/underpagebackgroundcolor.md
- This is the rubber-band (overscroll) color. With `viewport-fit=auto`, it also fills the safe-area inset regions: "The inset area is filled with the page's background-color": https://webkit.org/blog/7929/designing-websites-for-iphone-x/

### 1.3 `sampledPageTopColor`: `PageColorSampler::sampleTop`
Source: Source/WebCore/page/PageColorSampler.cpp — https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/PageColorSampler.cpp
- The feature is disabled when `sampledPageTopColorMaxDifference <= 0`. Its default in WebKit is 0, and Safari sets the value through `_sampledPageTopColorMaxDifference` and `_sampledPageTopColorMinHeight` on the configuration.
  - Default values: https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml
  - Plumbing: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKWebView.mm
  - Safari's actual values are not public.
- Sampling: 5 one-pixel snapshots along y=0, at x = w·i/4 for i=0..4.
- A sample location is **invalid**, and the whole result becomes "no color", if the hit-test stack at that point contains any of:
  - an `<img>` or a CSS background-image
  - an element with a running transition or animation
  - a `<canvas>` that has a rendering context
  - an `<iframe>`
- Colors are compared in Lab using Euclidean distance (ΔE76) between neighboring samples.
  - A difference above `maxDifference` fails the sample, except that **one** outlier is allowed if it is the first or the last sample. That outlier is excluded from the average.
  - The cumulative difference across samples is also bounded by `maxDifference`.
- If `minHeight > 0`, two more checks are taken at (0, minHeight−1) and (w, minHeight−1). Each must be within `maxDifference` of the corresponding edge sample.
- Result: the Lab average of the accepted samples. The value is computed once per load and cached in `Page::computeSampledPageTopColorIfNecessary`.
- Used pre-iOS 26 (Safari 15+) as the tab-bar tint fallback when no theme-color is set. That behavior is inferred from the Safari 15 blog, which lists theme-color as primary; Apple does not document the fallback.

### 1.4 Fixed container edges (iOS 26 / Liquid Glass): `LocalFrameView::fixedContainerEdges`
Sources:
- Source/WebCore/platform/FixedContainerEdges.h — https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/FixedContainerEdges.h
- LocalFrameView.cpp (link above)
- Introduced as a prototyping SPI in https://bugs.webkit.org/show_bug.cgi?id=287734 (commit 290447@main)

Each edge holds `Variant<PredominantColorType{None,Multiple}, Color>`.

Algorithm, run per side:
1. Skip entirely if there are no viewport-constrained (fixed or sticky) objects.
2. Compute `fixedRect`:
   - start from the layout viewport for fixed positioning
   - intersect it with the document rect
   - contract it by **4px**
3. Hit-test at the **midpoint of that side** of `fixedRect`.
   - The first attempt ignores `pointer-events`.
   - If it hits an invisible `pointer-events:none` container, it retries while honoring `pointer-events`.
4. If the hit element has a `::backdrop` (modal dialog or popover), it counts as a dimming layer. Its color is the backdrop's background color, or `pageExtendedBackgroundColor` if that is invisible.
5. Otherwise, walk the ancestors and classify each one (`containerEdgeCandidateResult`):
   - The element must have a layer and must be `position: fixed` or `sticky`.
   - Hidden or nearly transparent elements are skipped.
   - The element's length along the side is compared with the viewport length. Below 0.9× counts as Smaller, below 1.05× as Similar, and anything else as Larger. The same comparison is made for the adjacent side.
   - Classification rules:
     - Smaller along the side but not along the adjacent side → **Sidebar**
     - Smaller on both → TooSmall
     - Larger on the adjacent side → TooLarge (unless it is a dimming layer)
     - No children, has a background, transparent or alpha<1, and not Smaller on either axis → **DimmingLayer**
     - Similar×Similar → ViewportSized (rejected if z-index is negative)
     - Otherwise → **Candidate**. The first candidate wins.
   - While walking, the code collects the first visible background-color found. It only counts boxes larger than 10px on both axes that are not Smaller than the viewport along the side.
   - Two different colors make the result "multiple". Any `backdrop-filter` in the chain also makes the edge `Multiple`.
6. Color resolution:
   - **Dimming, viewport-sized, or sidebar** results reuse the previous edge color if one exists.
   - A **visible background color** is used next:
     - If it is a dimming layer, or alpha < **0.75**, it is blended source-over onto `pageExtendedBackgroundColor`.
     - Otherwise its alpha is forced to 1.
   - If the container is the same one as last time, the previous color is kept.
   - **Otherwise, pixels are sampled**: a 2px-thick strip along that edge of fixedRect, shifted inward by the border width when the border is ≤10px.
     - `PageColorSampler::predominantColor` takes 29 pixel samples and ignores invisible pixels.
     - A color that wins more than 67% of samples (>19.43) is used. Otherwise similar colors (sRGB distance² ≤ 36, on a 0–255 scale) are grouped by descending frequency.
     - If no color reaches the threshold, the result is `Multiple`. A nearly transparent result is `None`.
   - The same alpha rule (<0.75 → blend) applies to sampled colors.
7. Scroll gating in `Page::updateFixedContainerEdges`:
   - A side is not sampled while the page is rubber-banded past that edge.
   - The top edge is only re-sampled after scrolling if `TopContentInsetBackgroundCanChangeAfterScrolling` is set. That setting is **true on small-screen (iPhone) iOS**. Otherwise the top is sampled only before the user scrolls or interacts, or while the page is still parsing.
   - Sources: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Page.cpp and https://github.com/WebKit/WebKit/blob/main/Source/WebKit/Shared/Cocoa/WebPreferencesDefaultValuesCocoa.mm

## 2. UI side (WKWebView.mm): what paints the inset areas in iOS 26
Source: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKWebView.mm
- `ContentInsetBackgroundFillEnabled` defaults to `isLiquidGlassEnabled()`, so it is on in iOS 26: WebPreferencesDefaultValuesCocoa.mm (link above).
- `_updateFixedColorExtensionViews`: for each side with an obscured inset > 0 **and** a fixed edge, a `WKColorExtensionView` is shown under the browser chrome.
  - Its color is the edge's predominant color, or `underPageBackgroundColor` when the edge is `Multiple` or invalid.
  - Otherwise the view fades out, and the glass simply shows scrolled content over the page background.
- Top scroll pocket color (`_setInternalTopPocketColor`): sampled top fixed color, else `underPageBackgroundColor`.
  - On iPhone ("soft pocket") it is only overridden when the top inset is visible and a top fixed color exists. On iPad ("hard pocket") it is always set.
- During top rubber-banding with a refresh control, the top extension grows only if:
  - the fixed color is not similar to underPageBackgroundColor, and
  - (for older SDK links) it is similar to sampledPageTopColor.
  - Code: `_obscuredInsetsForFixedColorExtension`.
- Apple confirmed the behavior: the tint extends only "when a fixed or sticky element sits near a viewport edge next to an obscured content inset (macOS top toolbar, iOS compact tab bar)". Otherwise the bar shows the page background: https://bugs.webkit.org/show_bug.cgi?id=301756
- Dialog and popover backdrops not extending was a regression, fixed in 301911@main, which added the ::backdrop path: https://bugs.webkit.org/show_bug.cgi?id=300965
- Top sampled color flicker on scroll fixed: https://bugs.webkit.org/show_bug.cgi?id=294621
- Observed side effect: opening a fixed popover or dialog re-tints both bars to its background: https://benfrain.com/ios26-safari-theme-color-tab-tinting-with-fixed-position-elements/
- `obscuredContentInsets` (new public API in 26) declares the areas covered by browser UI: https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes.md

## 3. Viewport / safe area
- `viewport-fit=auto` (default): content is inset and the inset area is filled with the html/body background. `viewport-fit=cover` makes the content extend to the screen edges.
  - `env(safe-area-inset-top|right|bottom|left)` expose the insets. The legacy `constant()` was removed in iOS 11.2.
  - Source: https://webkit.org/blog/7929/designing-websites-for-iphone-x/
- `env(safe-area-inset-bottom)` is only meaningful with `viewport-fit=cover`: https://benfrain.com/ios26-safari-theme-color-tab-tinting-with-fixed-position-elements/

## 4. Standalone (Home Screen web app)
- `apple-mobile-web-app-status-bar-style` only applies in web-app mode. Values:
  - `default`: normal status bar, content below it
  - `black`: black background, content below it
  - `black-translucent`: content goes under the status bar (full screen); this pairs with `safe-area-inset-top`
  - The default value is `default`.
  - Source: https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html
- iOS 26: every site added to the Home Screen opens as a web app by default, and users can turn this off: https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ and https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes.md
- No primary source was found for how Safari colors a status bar set to `default` in standalone mode (theme-color vs. background). Treat this as **unverified**. Empirically, it is a white or black bar that follows the color scheme, and theme-color colors it when present.

## 5. Device metrics (portrait, pt)
Source: https://useyourloaf.com/blog/iphone-16-screen-sizes/ (secondary source, but measured from simulator values)

| Device | Screen | Inset top | Inset bottom | Landscape (L/R, bottom) |
|---|---|---|---|---|
| iPhone 16 / 16 Plus | 393×852 / 430×932 | 59 | 34 | 59, 21 |
| iPhone 16 Pro / Pro Max | 402×874 / 440×956 | 62 | 34 | 62, 21 |

- Safari toolbar heights (compact or bottom tab bar, Liquid Glass) are not published by Apple. The page can measure them with `100lvh − 100svh` or `visualViewport`.
- On iOS 26 the toolbar overlays the content, and its size is reported through `obscuredContentInsets`.
- Any constant used for these heights in a simulator should be marked as empirical.

## 6. Deterministic model for a simulator

**iOS 26+ browser tab, per edge (top and bottom):**
- If FCE(edge) is a Color → paint the bar backing with it.
- If FCE(edge) is Multiple or invalid, but a fixed or sticky container was found → paint `underPageBackgroundColor`.
- Otherwise → no extension view. The glass shows the content scrolling beneath it, and the overscroll area shows `underPageBackgroundColor` = base(white) ⊕ html bg ⊕ body bg.
- theme-color is ignored.

**iOS 15–18 compact layout:**
- tint = the active theme-color (first media-matching valid meta tag, then the manifest).
- If there is none, use sampledPageTopColor when the samples agree.
- Otherwise use underPageBackgroundColor.
- Overscroll uses the theme-color too, per the Safari 15 blog.
- Exact precedence is inferred, because Safari's own UI code is closed.
