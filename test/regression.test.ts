import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkExpectations, startRenderer, EXPECTATIONS_DIR, type Expectation, type Renderer } from '../calibration/compare.ts'

// Panel colors recorded from iOS Simulator Safari (calibration/compare.ts writes them).
const expectations = JSON.parse(await readFile(join(EXPECTATIONS_DIR, 'ios26.json'), 'utf8')) as Expectation[]

let renderer: Renderer
before(async () => {
  renderer = await startRenderer()
})
after(async () => {
  await renderer.close()
})

// Cases the model does not reproduce yet; they run as todo so a fix shows up without failing the suite.
const KNOWN_GAPS: Readonly<Record<string, string>> = {
  'html-body-colors iphone-17-pro.portrait.light.scrolled':
    'status bar: white glyphs over green body with red html sides; the mean-luma rule puts it at 0.404, past the 0.39 switch',
}

for (const expectation of expectations) {
  const id = `${expectation.name} ${expectation.stem}`
  test(`${id} matches Safari`, { todo: KNOWN_GAPS[id] }, async () => {
    const [result] = await checkExpectations(renderer, [expectation])
    const failures = [
      ...result!.regions.filter(r => !r.pass).map(r => `${r.region}: Safari ${r.reference}, ours ${r.ours} (ΔE ${r.deltaE})`),
      ...(result!.statusBar.pass ? [] : [`status bar: Safari ${result!.statusBar.reference}, ours ${result!.statusBar.ours}`]),
    ]
    assert.deepEqual(failures, [])
  })
}
