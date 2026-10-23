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

## Glass

Glass pills show the blurred content under them through a color transform fitted on uniform
backgrounds (`calibration/fit-glass.ts`): saturate 2.25, scale 0.48, offset +0.538, in sRGB.
White stays white; `#1e88e5` → `#64d3ff`; `#8e24aa` → `#fa8aff`. [sim]

## Known gaps

- Fonts: Safari renders with SF Pro; Playwright WebKit on Linux falls back to other fonts, so text
  rows can sit a few points off. Panel colors are unaffected.
- Dark appearance, landscape, standalone (home screen) mode and devices other than the iPhone 17 Pro
  are not calibrated yet.
