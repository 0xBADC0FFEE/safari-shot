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
const KNOWN_GAPS: Readonly<Record<string, string>> = {
  'ios26 html-body-colors iphone-17-pro.portrait.light.scrolled':
    'status bar: white glyphs over green body with red html sides; the mean-luma rule puts it at 0.404, past the 0.39 switch',
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
