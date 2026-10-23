# What iOS 26 Safari paints around a page

Each rule says where it comes from: **[src]** is WebKit source (`main`, read 2026-10-23), and
**[sim]** is observed on the iOS 26.5 Simulator and kept as a regression test in
`calibration/references`. Background research is in [research/](research/).

## Geometry (iPhone 17 Pro, portrait, points)

| | value | source |
|---|---|---|
| Screen | 402 × 874 @3x | [sim] |
| Status bar inset; the layout viewport starts below it | 62 | [sim] fixed `top: 0` element lands at y = 62 |
| Toolbar inset, expanded | 98 (layout viewport 714) | [sim] `innerHeight` |
| Toolbar inset, collapsed | 58 (layout viewport 754 = `100lvh`) | [sim] `innerHeight` after a touch scroll |
| `env(safe-area-inset-*)` in a browser tab | 0, even with `viewport-fit=cover` | [sim] |
| Expanded toolbar | back ⌀48 at x 34–82, URL pill 89–313 × 48, menu ⌀48 at 320–368, bottom margin 34 | [sim] |
| Collapsed toolbar | URL pill, height 32, centered, bottom margin 14, 12.6 pt host name | [sim] |

Other iPhones (17 Pro Max, 17, Air, 17e, 16e, SE 3rd gen) share the toolbar insets (98 / 58) and
layout; only the status bar inset (Air 68, 17e/16e 47, SE 20) and glyph placement differ. The SE uses
the classic layout: signal and Wi-Fi left, time centered, battery right. [sim]

- Programmatic scrolling (`scrollTo`) does **not** collapse the toolbar; only a touch scroll does. [sim]
- Content scrolls under both bars; nothing clips it at the layout viewport. [sim]
- At the top or bottom of the page, and on load, the toolbar is expanded. [sim]

## Panel colors

1. **Under-page color** = base (white) ⊕ `html` background ⊕ `body` background; images and
   gradients are ignored. It fills the overscroll area and every inset without a color extension. [src][sim]
2. **Color extension** per side, from `LocalFrameView::fixedContainerEdges`: [src][sim]
   - Hit-test the midpoint of that side of the layout viewport, inset by 4 px, ignoring `pointer-events`
     first (retry honoring it when an invisible `pointer-events: none` layer was hit).
   - A hit inside a modal `<dialog>` / popover uses its `::backdrop` color, blended over the
     under-page color.
   - Otherwise walk up to the first `fixed`/`sticky` ancestor. Width along the side is compared with
     the viewport: < 0.9× is *smaller*, < 1.05× *similar*, else *larger*. Smaller along the side →
     sidebar (or too small if also smaller across); larger across → too large; similar on both →
     viewport-sized.
   - The color is the first visible `background-color` on the lineage (boxes > 10 px, not smaller than
     the viewport). Two different colors → none; `backdrop-filter` anywhere → *multiple*.
   - Alpha < 0.75 (or a dimming layer) → blended over the under-page color; otherwise forced opaque.
   - No background color → a 2 px strip is snapshotted with only fixed/sticky layers (no text, no
     images) and 29 pixels vote; a color needs > 67 %, grouping colors within distance² ≤ 36.
3. An edge found once is **kept** while its element stays visible, even when the element no longer
   touches the edge (`Page::updateFixedContainerEdges`). Dimming, viewport-sized and sidebar
   containers keep the existing color instead of replacing it. [src]
4. **What is painted** (`_updateFixedColorExtensionViews`): a side with an inset and a fixed edge
   gets a solid extension; *multiple* uses the under-page color. Without a fixed edge, content
   shows through under the glass. [src][sim]
5. **Overscroll at the top** with the refresh control: the top extension grows to fill the gap when
   its color is not similar to the under-page color; otherwise the gap shows the under-page color. [src][sim]
6. `theme-color` (meta or manifest) does **not** affect the panels. [sim] It is still reported.
7. **A popover's `::backdrop`** extends like a modal dialog's, although `elementFromPoint` cannot hit it
   (the UA sheet makes it `pointer-events: none !important`). [sim]

## Scroll edges

- **Top**: the pocket color (the top extension, else the under-page color) over content, opacity
  0.81 at the screen top fading to 0 at 100 pt. [sim]
- **Bottom, expanded toolbar, no extension**: the predominant color of the content along the screen's
  bottom edge over content, opacity 0.85 at the bottom fading to 0 at 136 pt. When an image, gradient,
  canvas, iframe or animation sits under a bottom sample point (as in `PageColorSampler::sampleTop`),
  the pocket is black at 31 % of that opacity instead. Collapsed toolbar: no bottom pocket. [sim]

## Status bar

Glyphs are white when the Rec. 709 luma of the gamma-encoded mean color under the status bar
(extension color, else content with the under-page color in the gaps) is ≤ 0.39, black otherwise.
`#ff0000` (0.21) and `#795548` (0.36) get white; `#2e7d32` (0.40) and `#808080` (0.50) black. [sim]

## Glass

Glass pills show the blurred backdrop through a color transform in sRGB, fitted on uniform swatches: [sim]

| variant | when | transform | ink |
|---|---|---|---|
| light | backdrop luma > 0.206 | saturate 2.25, ×0.48, +0.538 | black |
| dark | backdrop luma ≤ 0.206 | saturate 2.25, ×0.53, +0.098 | white |

The backdrop is the bottom extension color, else the mean content under the toolbar: `#333333` gets
dark glass, `#003f7f` light. Over a container's color extension, and over the default black pocket,
24 % white is mixed into the fill; over a `::backdrop` extension it is not. The pills cast a shadow
of about 0 11 px 42 px at 16 % black. [sim]

## iOS 18 (simplified model)

Observed on the iOS 18.6 Simulator, iPhone 16 Pro, portrait, light appearance. [sim]

| | value |
|---|---|
| Status bar band | 62 pt, solid: `theme-color`, else the sampled page top, else the under-page color, in every scroll state |
| Toolbar, expanded | 134 pt: URL field 28–374 × 748–793 (radius 12) over a five-button row, then the home indicator |
| Toolbar, collapsed | 52 pt: host name over the bottom-edge content color at 86 % |
| Layout viewport | 678 expanded, 760 collapsed |

- **Sampled page top** (`PageColorSampler::sampleTop`): five samples at y = 0 must agree with each
  other and with the samples 100 pt lower (Safari's thresholds are private; a 300 pt hero is sampled,
  a 56 pt fixed bar and a 40 pt `html` margin are not), and no image, canvas, iframe or animation may
  sit under them.
- **Glyphs** are white when the band's luma is ≤ 0.55 (`#808080` at 0.50 gets white, `#ff7f7f` at 0.61 black).
- **Material**: blurred content, saturate 0.775, ×0.422, +0.717 (RMSE 4.2 over solid colors); the URL
  field is 82 % white over it. The dark material is not calibrated.
- Other devices assume the same toolbar above their home-indicator inset; landscape is not modeled.

## Known gaps

- Fonts: Safari renders with SF Pro; Playwright WebKit on Linux falls back to other fonts, so text
  rows can sit a few points off. Panel colors are unaffected.
- Dark appearance, landscape and standalone (home screen) mode are not calibrated yet; other devices
  have measured geometry but no color references.
- The top pocket on devices other than the iPhone 17 Pro is scaled to their status bar inset, unmeasured.
- Status bar glyphs over mixed content near the 0.39 switch can come out wrong
  (`html-body-colors`, scrolled: Safari white, model black).
- iOS 18 status band: Safari ignores full-screen overlays and backdrops (`fixed-overlay-full`,
  `dialog-modal`, `popover`), and tints with some fixed top bars (`fixed-both`, `fixed-pointer-none`)
  but not others (`fixed-top`); the model samples what it sees.
