import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { webkit, type Browser } from 'playwright'
import { probePage, SIDES, type PageFacts } from '../src/page-probe.ts'
import { findCase } from '../calibration/corpus.ts'

const VIEWPORT = { width: 402, height: 714 }
const LARGE_VIEWPORT = { width: 402, height: 754 }

let browser: Browser
before(async () => { browser = await webkit.launch() })
after(async () => { await browser.close() })

async function probeCase(name: string): Promise<PageFacts> {
  const corpusCase = findCase(name)
  assert.ok(corpusCase, `unknown corpus case ${name}`)
  const page = await browser.newPage({ viewport: VIEWPORT })
  try {
    await page.setContent(corpusCase.html, { waitUntil: 'load' })
    return await page.evaluate(probePage, { defaultViewportUnits: LARGE_VIEWPORT, sides: [...SIDES], edgeSampleCount: 5, previousContainerIds: {} })
  } finally {
    await page.close()
  }
}

test('a full-width fixed header is the top candidate with its background color', async () => {
  const { edges } = await probeCase('fixed-top')
  assert.equal(edges.top.kind, 'container')
  assert.deepEqual(edges.top.kind === 'container' && edges.top.backgroundColor, { r: 255, g: 152, b: 0, a: 1 })
  assert.equal(edges.bottom.kind, 'no-container')
})

test('a narrow fixed bar is too small and yields no container', async () => {
  const { edges } = await probeCase('fixed-top-narrow')
  assert.equal(edges.top.kind, 'no-container')
})

test('the background of a child inside a transparent fixed bar is collected', async () => {
  const { edges } = await probeCase('fixed-top-nobg-child')
  assert.deepEqual(edges.top.kind === 'container' && edges.top.backgroundColor, { r: 67, g: 160, b: 71, a: 1 })
})

test('backdrop-filter on the bar is reported', async () => {
  const { edges } = await probeCase('fixed-top-backdrop')
  assert.equal(edges.top.kind === 'container' && edges.top.foundBackdropFilter, true)
})

test('an invisible pointer-events:none overlay is retried honoring pointer events', async () => {
  const { edges } = await probeCase('fixed-pointer-none')
  assert.equal(edges.top.kind === 'container' && edges.top.container, 'div.bar-top')
})

test('a translucent full-screen overlay without children is a dimming layer', async () => {
  const { edges } = await probeCase('fixed-overlay-full')
  assert.equal(edges.top.kind === 'container' && edges.top.isDimmingLayer, true)
})

test('a modal dialog reports its ::backdrop color', async () => {
  const { edges } = await probeCase('dialog-modal')
  assert.equal(edges.top.kind === 'container' && edges.top.fromBackdrop, true)
  assert.deepEqual(edges.top.kind === 'container' && edges.top.backgroundColor, { r: 33, g: 150, b: 243, a: 0.6 })
})

test('theme-color candidates keep document order and media matching', async () => {
  const { themeColors } = await probeCase('theme-color-media')
  assert.deepEqual(themeColors.map(t => t.matches), [true, false])
})

test('a page without fixed or sticky elements skips edge sampling', async () => {
  const facts = await probeCase('body-color')
  assert.equal(facts.hasViewportConstrainedObjects, false)
  assert.deepEqual(facts.bodyBackground, { r: 30, g: 136, b: 229, a: 1 })
})
