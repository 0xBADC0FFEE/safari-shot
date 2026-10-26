# Contributing

safari-shot is reverse engineering: every rule in [src/](src/) reproduces something iOS Safari does,
and is proven either by WebKit source or by a Simulator screenshot it matches. The rules and their
evidence live in [docs/safari-rules.md](docs/safari-rules.md); user-facing usage is in
[README.md](README.md). Background research from before the code existed is in
[docs/research/](docs/research/).

## The calibration loop

Run every behaviour change through these steps, in order. Each ends on its completion criterion.

1. **Look up what is known.** Read [docs/safari-rules.md](docs/safari-rules.md) and `KNOWN_GAPS` in
   [test/regression.test.ts](test/regression.test.ts). Done when you can say whether the behaviour is
   already modeled, already a known gap, or new.
2. **Read the source.** Find the WebKit function behind the behaviour (for example
   `LocalFrameView::fixedContainerEdges`, `PageColorSampler::sampleTop`) and port its logic rather than
   guessing from pixels. Done when the rule is ported and cited as **[src]**, or you have established
   that the code is not public (UIKit, Liquid Glass) and the rule must be fitted.
3. **Isolate one variable.** Add a minimal page to [calibration/corpus.ts](calibration/corpus.ts) that
   changes exactly one thing against an existing case. Uniform full-page colors are the cleanest
   fitting input; add pastels and mid-tones when a fit needs the backdrop's luma to vary.
4. **Capture references** on the Simulator (see [Simulator](#simulator)). Done when the capture log
   lists every case and state and `grep -c skipped` prints 0.
5. **Check geometry before color.** Compare `inner` heights and `scrollY` in
   `calibration/out/reports/<case>.ios<version>.<stem>.json` against the model. A color fit on wrong
   geometry is fitting noise.
6. **Compare.** `node calibration/compare.ts --ios <v> --match '<stem regex>'` for the fast loop over
   the stems you touch. Done when every miss is either fixed or classified (see
   [Diagnosing a miss](#diagnosing-a-miss)).
7. **Fit constants** that source cannot give: `node calibration/fit-glass.ts --ios <v> --theme <t>`.
   Write the fit's provenance (tool, sample set, RMSE) in a comment beside the constant.
8. **Record.** Add or update the rule in [docs/safari-rules.md](docs/safari-rules.md) tagged **[src]**
   or **[sim]**; add each unresolved miss to `KNOWN_GAPS` with one sentence of observed fact.
9. **Update the agent skill.** [skills/safari-shot/SKILL.md](skills/safari-shot/SKILL.md) is how
   agents learn the CLI. Done when every CLI option, report field, default and limit it mentions
   matches the code, and every user-visible change (new option, new iOS version, a limit lifted)
   appears in it.
10. **Verify.** `npm test` (about 25 minutes; run it in the background). Done when it reports
   `fail 0`; known gaps run as todo, so a fix that makes one pass shows up without failing the suite.

## Diagnosing a miss

Read the ΔE of a failing region as the size of the wrong assumption:

| ΔE | usually means |
|---|---|
| < 5 | a constant to tune: shadow strength, blur, a fitted offset |
| 10–20 | the wrong variant: band threshold, whitening, a pocket of the wrong strength |
| > 40 | a structural error: a layer Safari does not draw (or draws and the model omits), wrong ink, wrong base color |

- **Look at the pixels** before touching a constant. Our renders land in `calibration/out/compare/`;
  crop the reference with `sips` and read both images. Numbers say how far off; images say why.
- **Fit one transform across all samples first.** iOS 27's light glass is a single matrix over
  every backdrop (RMSE 0.7). Split into luma bands only when one transform leaves RMSE above about 3,
  then search the split point (`fit-glass.ts` groups by the bands in [src/chrome.ts](src/chrome.ts)).
- **Clamp after the matrix.** Glass transforms are saturate, then scale, then offset, clamped to 0–1;
  the clamp is what lets one matrix both saturate mid-tones and flatten pastels.
- **Stop tuning when cases conflict.** When the value that fixes one case breaks another (iOS 27's top
  pocket: half strength fixes `top-hero`, breaks `body-gradient` by more), the model's shape is wrong.
  Pick the setting with fewer misses and record the rest as a known gap.
- **Write gaps as observations.** State what Safari shows and what the model does; claim a direction
  or a cause only after checking it on the image.

## Desktop WebKit is not iOS WebKit

Playwright renders with desktop WebKit, which differs from iOS Safari in ways the capture code
compensates for. Before blaming the model, rule these out:

- **Canvas color**: desktop dark mode paints `#1e1e1e`; iOS paints black for pages that declare
  dark support (root `color-scheme` or `<meta name="color-scheme">`) and white otherwise. Captures
  are taken transparent and flattened over the iOS base; flattening over the under-page color blends
  translucent bodies twice.
- **Toolbar collapse**: only a touch scroll collapses Safari's toolbar; `scrollTo` does not.
  The capture resizes the viewport itself.
- **`env(safe-area-inset-*)`** is 0 in a Safari tab, even with `viewport-fit=cover`.

## Simulator

Captures need macOS with Xcode. [calibration/simulator.ts](calibration/simulator.ts) boots the
device, pins the status bar to 9:41 and charged, and drives Safari through the XCUITest driver in
[calibration/driver/](calibration/driver/).

```bash
node calibration/capture-references.ts --udid <udid> --ios 27 --themes light,dark --port 8769
```

- **One simulator and one `--port` per parallel capture.** Captures and compares can run side by
  side; `compare.ts` serves the corpus on its own ephemeral port.
- **Pick devices per runtime.** The iPhone 17 Pro on iOS 26 never rotates; capture landscape on the
  iPhone 17 (`--device iphone-17`). The iOS 27.1 runtime only accepts "iPhone Duo"; use 27.0 for the
  iPhone 17 Pro.
- **iOS 18 has no `scrollend`.** The reporter falls back to debounced `scroll` events
  (`scroll-settled`); a scrolled reference without a settled state was captured unscrolled.
- **Safari's chrome hides controls.** On iOS 26 portrait the Tabs button lives inside the "…" menu,
  and a scrolled landscape page hides all chrome until the screen top is tapped; the driver's
  `closeAllTabs` handles both.
- Shut down the simulators you booted when the work is done.

## Expectations and tests

[calibration/expectations/](calibration/expectations/) holds one JSON per iOS version: each
reference's region colors and status-bar glyphs. They depend on the references and the region
layout, not on the model, so a model change needs no rebuild; rerun the tests instead.

- `compare.ts` rewrites `ios<v>.json` only on an unfiltered run. Run it only after a capture
  finishes: half-written references crash it or leak into the file.
- Check one slice of the suite without the full 25 minutes:
  `node --test --test-name-pattern 'ios27 .*dark' test/regression.test.ts`.
- `KNOWN_GAPS` keys are `ios<v> <case>` for a whole case or `ios<v> <case> <stem>` for one stem.

## Working practice

- **Long runs go in the background.** A compare takes about 10 minutes per 180 stems; a full capture
  takes about an hour per theme.
- **Scratch scripts** go in `calibration/out/tmp/` (ignored; imports resolve the project's
  `node_modules`).
- **Wait loops**: `pgrep -f <pattern>` matches the shell running the loop, so
  `until ! pgrep -f X` never ends. Wait on a log line or a PID instead.
- The shell is zsh on macOS: an unmatched glob aborts the command, and BSD `sed` has no `\b`
  (use `perl -pi -e`).

## Pull requests and releases

- `main` is protected: changes land through squash-merged pull requests with green `Build` and
  `Test` checks. The pull request title becomes the commit on `main`, so it follows Conventional
  Commits.
- **Release** is automatic: on every push to `main` the [release workflow](.github/workflows/release.yml)
  runs semantic-release, which picks the version from the commits since the last `v*` tag
  (`fix:` → patch, `feat:` → minor, `!` or `BREAKING CHANGE:` → major; other types release
  nothing), tags it, creates the GitHub release and publishes to npm through trusted publishing,
  with provenance; no npm token is stored in the repository.
- `version` in [package.json](package.json) stays `0.0.0-development`: the released version lives
  in the tags and on npm, never in a commit.
