# DIY "what iOS Safari draws outside the layout viewport" simulator in Playwright

Sources:
- CDP Emulation domain (pdl, ToT): https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Emulation.pdl / https://chromedevtools.github.io/devtools-protocol/tot/Emulation/
- Playwright CDPSession: https://playwright.dev/docs/api/class-cdpsession ; screenshots: https://playwright.dev/docs/api/class-page#page-screenshot ; emulation: https://playwright.dev/docs/emulation
- CSS env(): https://drafts.csswg.org/css-env-1/ ; MDN env(): https://developer.mozilla.org/en-US/docs/Web/CSS/env
- MDN theme-color: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/theme-color
- MDN viewport-fit: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport
- Visual Viewport API: https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API
- WebKit "Designing websites for iPhone X": https://webkit.org/blog/7929/designing-websites-for-iphone-x/
- sharp composite: https://sharp.pixelplumbing.com/api-composite ; blur: https://sharp.pixelplumbing.com/api-operation#blur

## 1. Injecting env(safe-area-inset-*)

### Chromium (works)
CDP has `Emulation.setSafeAreaInsetsOverride` (experimental) taking `SafeAreaInsets {top, topMax, left, leftMax, bottom, bottomMax, right, rightMax}` (integers, CSS px). Per the pdl: "Unset values will cause the respective variables to be undefined, even if previously overridden." So always send all four (and the *Max variants if you test `safe-area-max-inset-*`). It is recent (Chrome ~136+); check `chromium.version()` — older Playwright-bundled Chromium returns "method not found".

```js
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setSafeAreaInsetsOverride', {
  insets: { top: 59, bottom: 34, left: 0, right: 0, topMax: 59, bottomMax: 34 }
});
```
Caveats:
- Chromium applies env() regardless of `viewport-fit=cover`; iOS Safari only exposes nonzero insets with `viewport-fit=cover` (WebKit blog). Emulate that: read the meta tag and send zeros when not `cover`.
- Apply after navigation-safe (it persists per target; re-send after cross-process navigations to be safe).
- Fallback for old Chromium: DevTools device-mode notch frames are front-end only and do not set env(). Alternative fallback: rewrite stylesheets (`env(safe-area-inset-top` -> literal px) via `page.route` or inject `CSSStyleSheet` edits — brittle.

### Playwright WebKit (no direct API)
Playwright's WebKit build (GTK/WPE on Linux, also mac port) has no protocol command for safe-area insets; `env(safe-area-inset-*)` resolves to 0. Playwright `isMobile` in WebKit enables meta-viewport but not insets. Only workaround: CSS rewrite (route-intercept CSS/HTML, replace `env(safe-area-inset-X[, fallback])` with values), or add `:root{--sai-top:..}` and rewrite to var(). Treat WebKit run as "layout fidelity" check, Chromium as "inset" check.

## 2. Capturing content beyond the visible area

iOS draws page content under the translucent toolbars / status bar (with viewport-fit=cover, and in iOS 26 Safari's "compact"/floating bar, content scrolls behind bars). Strategy: make the layout viewport = full screen and treat bar regions as overlays, OR render a larger viewport and composite.

A. Simple and robust: viewport = full device screen (e.g. 402x874 for iPhone 16 Pro, DPR 3), insets set via CDP, screenshot full viewport, then paint bars on top at the top/bottom bands. `position:fixed; bottom:0` elements then sit where iOS puts them when the toolbar is collapsed.

B. Simulate expanded toolbars (layout viewport smaller than screen, i.e. iOS "large viewport vs small viewport" — svh/lvh): 
- Chromium: `Emulation.setDeviceMetricsOverride` has experimental `screenWidth/screenHeight/positionX/positionY` and `dontSetVisibleSize` + `Emulation.setVisibleSize` (deprecated). These change screen metrics, not what is painted outside the view; Chromium does not paint outside the viewport, so you cannot screenshot "under the bars" this way.
- Practical approach: take two renders: (1) viewport height = screen height (content as seen under bars; lvh), (2) viewport = screen minus bars (svh, where fixed elements anchor with expanded toolbars) and composite (2) offset by top-bar height over (1); bands come from (1). Note fixed-bottom elements differ between the two — that difference is exactly the iOS behavior to visualize.
- `page.screenshot({clip})` is clamped to the page/viewport in practice; content outside the viewport is not painted (except with fullPage, which scrolls/resizes and breaks fixed positioning). Don't rely on clip outside page bounds.
- Overscroll/rubber-band area: iOS paints the html/body background (or theme/`background` of root) there; simulate by extending the canvas with the root background color (`setDefaultBackgroundColorOverride` only affects transparent base, not the root background).

## 3. Computing the toolbar tint via page.evaluate

iOS 15+ Safari tints bars from `<meta name="theme-color">` (with `media` for dark), else samples page colors; iOS 26 uses the color of fixed/sticky elements touching the edge, else the body/html background. Heuristic extractor:

```js
const tint = await page.evaluate(() => {
  const mq = m => !m || matchMedia(m).matches;
  const meta = [...document.querySelectorAll('meta[name="theme-color"]')]
    .find(m => mq(m.getAttribute('media')))?.content ?? null;
  const bg = el => getComputedStyle(el).backgroundColor;
  const W = innerWidth, H = innerHeight;
  const edge = y => {
    for (const el of document.elementsFromPoint(W/2, y)) {
      const cs = getComputedStyle(el);
      if ((cs.position === 'fixed' || cs.position === 'sticky') &&
          cs.backgroundColor !== 'rgba(0, 0, 0, 0)')
        return { color: cs.backgroundColor, rect: el.getBoundingClientRect().toJSON(),
                 backdrop: cs.backdropFilter };
    }
    return null;
  };
  return { meta, html: bg(document.documentElement), body: bg(document.body),
           top: edge(1), bottom: edge(H - 1),
           scheme: getComputedStyle(document.documentElement).colorScheme };
});
// priority: meta > fixed edge element > body (if not transparent) > html > white/black by scheme
```
Caveats: canvas background propagation (body bg propagates to canvas if html is transparent, CSS Backgrounds §2.11.2); gradients/images in `background-image` need pixel sampling instead — sample the screenshot strip (e.g. top 2px row median) with sharp `.extract().stats()`. Apple's exact heuristics are undocumented; validate against real device screenshots.

## 4. Composing the final PNG (sharp)

```js
import sharp from 'sharp';
const dpr = 3, W = 402*dpr, H = 874*dpr, topH = 62*dpr, botH = 84*dpr;
const shot = await page.screenshot(); // viewport-sized, DPR 3
const band = (top, h) => sharp(shot).extract({left:0, top, width:W, height:h})
  .blur(20).toBuffer();
const tintSvg = (h, rgba) => Buffer.from(
  `<svg width="${W}" height="${h}"><rect width="100%" height="100%" fill="${rgba}"/></svg>`);
const out = await sharp(shot).composite([
  { input: await band(0, topH), top: 0, left: 0 },
  { input: tintSvg(topH, 'rgba(255,255,255,0.72)'), top: 0, left: 0 },
  { input: await band(H-botH, botH), top: H-botH, left: 0 },
  { input: tintSvg(botH, 'rgba(255,255,255,0.72)'), top: H-botH, left: 0 },
  { input: 'statusbar.png', top: 0, left: 0 },      // clock/notch/Dynamic Island art
  { input: 'urlbar-pill.png', top: H-botH+20, left: 60 },
]).png().toFile('sim.png');
```
Notes: blur the extracted band (not the whole image) to mimic backdrop blur; for iOS 26 Liquid Glass, blur + low-alpha tint + rounded pill mask is a decent approximation. node-canvas alternative: `ctx.filter='blur(20px)'` then `drawImage`. Provide Dynamic Island / home-indicator as static assets.

## Overall caveats
- Not pixel-faithful: Apple's tinting/blurring heuristics are private; Playwright WebKit != iOS Safari (different ports, no UIKit chrome, no safe-area).
- Mobile emulation in Chromium (`isMobile`, `hasTouch`) affects meta viewport and overlay scrollbars but not iOS-specific `-webkit-` behaviors.
- Verify `env()` took effect: `page.evaluate(() => getComputedStyle(probe).paddingTop)` on an element with `padding-top: env(safe-area-inset-top)`.
