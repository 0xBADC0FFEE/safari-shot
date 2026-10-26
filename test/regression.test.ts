import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkExpectations, startRenderer, EXPECTATIONS_DIR, type Expectation, type Renderer } from '../calibration/compare.ts'

// Panel colors recorded from iOS Simulator Safari, one file per iOS version (calibration/compare.ts writes them).
const expectationFiles = (await readdir(EXPECTATIONS_DIR)).filter(file => file.endsWith('.json')).sort()
const expectations = (await Promise.all(expectationFiles.map(async file => JSON.parse(await readFile(join(EXPECTATIONS_DIR, file), 'utf8')) as Expectation[]))).flat()

let renderer: Renderer
before(async () => {
  renderer = await startRenderer()
})
after(async () => {
  await renderer.close()
})

// Cases the model does not reproduce yet, keyed by `ios<version> <case>` or `ios<version> <case> <stem>`;
// they run as todo so a fix shows up without failing the suite.
const IOS18_FIXED_BAR_TINT = 'status band: Safari tints with this fixed top bar but not with fixed-top or fixed-top-nobg-child; the rule is unknown'
const IOS18_OVERLAY = 'status band: Safari does not sample the page top through a full-screen overlay or backdrop'
const IOS26_DARK_GLASS = 'dark-appearance glass: the three luma bands miss this mixed or striped backdrop'
const IOS26_DARK_COLLAPSED = 'dark-appearance collapsed glass: fitted on the expanded toolbar only, it is too opaque over light content'
const IOS26_DARK_SHADOW = 'dark-appearance glass shadow: content just below the toolbar is ΔE 4–7 off over saturated colors'
const IOS27_MIXED_BACKDROP = 'iOS 27 glass: the mean backdrop does not predict the fill over striped or two-color content'
const IOS27_TOP_EDGE = 'iOS 27 top scroll edge: Safari tints the scrolled content under the status bar in a way the model does not draw'
const IOS27_GLYPHS = 'iOS 27 status bar: the mean-luma rule picks the wrong glyphs over a gradient or two-color top'
const LINUX_FONT = 'Linux: -apple-system falls back to a font that places less row text under the collapsed glass sample (ΔE 6.5; macOS 3.2)'
// `<case> <theme>.<state>` on the iPhone 17 Pro in portrait.
const gaps = (ios: string, gap: string, ...stems: string[]) => Object.fromEntries(stems.map(stem => [`ios${ios} ${stem.replace(' ', ' iphone-17-pro.portrait.')}`, gap]))
const KNOWN_GAPS: Readonly<Record<string, string>> = {
  ...gaps('27', IOS27_MIXED_BACKDROP, 'html-body-colors light.initial', 'html-body-colors dark.initial', 'pocket-stripes light.initial',
    'pocket-stripes dark.initial', 'pocket-stripes-dark light.initial', 'pocket-stripes-dark dark.initial'),
  ...gaps('27', IOS27_TOP_EDGE, 'top-hero light.scrolled', 'top-hero dark.scrolled', 'body-gradient dark.scrolled', 'canvas-top dark.scrolled'),
  ...gaps('27', IOS27_GLYPHS, 'body-gradient light.overscroll-bottom', 'body-gradient dark.overscroll-bottom', 'html-body-colors light.scrolled'),
  ...gaps('27', 'iOS 27 dark: Safari leaves the status bar black over this fixed top layer; the model paints the page color',
    'fixed-top-backdrop dark.scrolled', 'fixed-top-gradient dark.overscroll-top'),
  ...gaps('26', IOS26_DARK_GLASS, 'fixed-top-alpha dark.initial', 'fixed-top-alpha-high dark.initial', 'geometry dark.initial', 'geometry dark.scrolled', 'pocket-stripes dark.initial', 'swatch-003f7f dark.scrolled'),
  ...gaps('26', IOS26_DARK_COLLAPSED, 'fixed-top-alpha dark.scrolled', 'fixed-top-alpha-high dark.scrolled', 'fixed-top-backdrop dark.scrolled', 'pocket-stripes dark.scrolled', 'swatch-ffff00 dark.scrolled'),
  ...gaps('26', IOS26_DARK_SHADOW, 'swatch-0000ff dark.scrolled', 'swatch-00ff00 dark.initial', 'swatch-00ff00 dark.scrolled', 'swatch-ff00ff dark.scrolled'),
  ...gaps('26', 'status bar: the glyph style misses over a body gradient once it scrolls past the top', 'body-gradient dark.scrolled', 'body-gradient dark.overscroll-bottom'),
  'ios26 html-body-colors iphone-17-pro.portrait.light.scrolled':
    'status bar: white glyphs over green body with red html sides; the mean-luma rule puts it at 0.404, past the 0.39 switch',
  ...(process.platform === 'linux' ? gaps('26', LINUX_FONT, 'body-color dark.scrolled') : {}),
  'ios18 fixed-both': IOS18_FIXED_BAR_TINT,
  'ios18 fixed-pointer-none': IOS18_FIXED_BAR_TINT,
  'ios18 fixed-overlay-full': IOS18_OVERLAY,
  'ios18 dialog-modal': IOS18_OVERLAY,
  'ios18 popover': IOS18_OVERLAY,
  'ios18 pocket-stripes-dark iphone-16-pro.portrait.light.initial': 'material: one blur radius does not fit both striped and solid content',
}

for (const expectation of expectations) {
  const caseId = `ios${expectation.ios} ${expectation.name}`
  const id = `${caseId} ${expectation.stem}`
  test(`${id} matches Safari`, { todo: KNOWN_GAPS[id] ?? KNOWN_GAPS[caseId] }, async () => {
    const [result] = await checkExpectations(renderer, [expectation])
    const failures = [
      ...result!.regions.filter(r => !r.pass).map(r => `${r.region}: Safari ${r.reference}, ours ${r.ours} (ΔE ${r.deltaE})`),
      ...(result!.statusBar.pass ? [] : [`status bar: Safari ${result!.statusBar.reference}, ours ${result!.statusBar.ours}`]),
    ]
    assert.deepEqual(failures, [])
  })
}
