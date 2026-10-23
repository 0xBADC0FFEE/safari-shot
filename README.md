# safari-shot

Screenshots of web pages as iOS 27 Safari shows them on iPhone — including what Safari paints
under the status bar and the Liquid Glass toolbar — without a simulator. `--ios 26` selects the
iOS 26 glass; a simplified iOS 18 model (`--ios 18`, portrait) covers pre–Liquid Glass Safari. Runs anywhere Playwright
runs (Linux, Docker, macOS).

```bash
npx playwright install webkit
safari-shot https://example.com
```

```text
safari-shots/
  example-com/
    ios27/
      iphone-17-pro.portrait.light.initial.png  # 1206×2622, same framing as a Simulator screenshot
      iphone-17-pro.portrait.light.initial.json # why each panel looks the way it does
  manifest.json                                  # every shot of the run; also printed to stdout
```

## Usage

```bash
safari-shot <url...> [options]
```

| Option | Values | Default |
|---|---|---|
| `-d, --device` | preset ids, comma-separated, or `all` (`--list-devices` prints them) | `iphone-17-pro` |
| `--ios` | `27`, `26`, `18`, `all` (18: portrait only) | `27` |
| `-s, --state` | `initial`, `scrolled`, `overscroll-top`, `overscroll-bottom`, `all` | `scrolled` with `--scroll`, else `initial` |
| `-t, --theme` | `light`, `dark`, `all` | `light` |
| `-o, --orientation` | `portrait`, `landscape` | `portrait` |
| `--mode` | `browser`, `standalone` | `browser` |
| `--scroll` | px scrolled in the `scrolled` state; implies it without `--state` | `400` |
| `--overscroll` | pt of rubber-band in overscroll states | `150` |
| `--settle` | ms to wait after `load` | `500` |
| `--engine` | `webkit`, `chromium` | `webkit` |
| `--out` | output directory | `./safari-shots` |

Local files work too: `safari-shot ./dist/index.html`. From a checkout, put options after `--`:
`npm run shot -- https://example.com --scroll 200`.

Exit codes: `0` success, `1` runtime error, `2` bad arguments.

### States

- `initial` — fresh load at the top; toolbar expanded.
- `scrolled` — scrolled by `--scroll`; toolbar collapsed to the URL pill.
- `overscroll-top` — pulled down past the top with the refresh control showing.
- `overscroll-bottom` — pushed up past the end of the page.

### Report

Each PNG has a JSON report next to it. The part agents usually need:

```json
{
  "panels": {
    "top":    { "fill": "extension", "color": "#ff9800", "reason": "background-color of header.bar" },
    "bottom": { "fill": "content",   "color": "#ffffff", "reason": "no fixed/sticky container; content scrolls under the glass" },
    "statusBar": "dark-content",
    "overscrollColor": "#ff9800"
  },
  "underPageBackground": "#ffffff",
  "themeColor": { "color": "#d32f2f", "source": "<meta name=\"theme-color\" content=\"#d32f2f\">", "usedByPanels": false }
}
```

- `fill: "extension"` — Safari paints a solid color under that bar (`color`), taken from a fixed or
  sticky element touching the edge. `reason` names the element and the rule that picked it.
- `fill: "content"` — no extension: page content scrolls under the glass and fades into the scroll edge.
- iOS 18 reports `fill: "tint"` for the solid status-bar band (`theme-color`, else the sampled page
  top, else the under-page color), `"material"` for the expanded toolbar and `"bar"` for the collapsed one.
- `fixedEdges.atLoad` / `fixedEdges.final` — the raw per-side result of WebKit's
  `fixedContainerEdges`, before and after the scenario's scroll.

## How it works

1. Playwright (WebKit by default) loads the page with the layout viewport Safari would use
   (screen minus status bar and toolbar, measured on the iOS Simulator).
2. A port of WebKit's `LocalFrameView::fixedContainerEdges` runs in the page and decides each edge
   color, including the history rules of `Page::updateFixedContainerEdges` across load and scroll.
3. The page, the content above and below the layout viewport, and Safari's chrome are composed in a
   second browser page: color extensions, scroll edge effect, status bar, and glass toolbar.

The rules and where they come from are in [docs/safari-rules.md](docs/safari-rules.md).

## Calibration (macOS with Xcode only)

`calibration/` holds the reference corpus and the tooling that keeps the output matched to real
Safari in the iOS Simulator. Agents using the CLI never need it.

```bash
node calibration/capture-references.ts --udid <simulator-udid>   # Safari screenshots of every corpus page
node calibration/compare.ts --ios 27 --sheets                     # re-render and compare panel regions
node calibration/fit-glass.ts --ios 27 --theme dark               # refit the glass bands of one appearance
node calibration/fit-glass.ts --ios 18                            # refit the iOS 18 toolbar material
node calibration/measure-devices.ts --types "iPhone 17,iPhone Air"
```
