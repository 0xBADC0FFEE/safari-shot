import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planPanels, activeThemeColor } from '../src/model.ts'
import { underPageBackground, type PageCapture } from '../src/capture.ts'
import { NO_EDGES, type FixedEdges } from '../src/edges.ts'
import { findDevice } from '../src/devices.ts'
import type { PageFacts } from '../src/page-probe.ts'
import type { Scenario } from '../src/scenario.ts'
import { BLACK, type Rgba } from '../src/color.ts'

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }
const ORANGE: Rgba = { r: 255, g: 152, b: 0, a: 1 }
const INITIAL: Scenario = { state: 'initial', theme: 'light', orientation: 'portrait', mode: 'browser' }

function facts(overrides: Partial<PageFacts> = {}): PageFacts {
  return {
    url: 'https://example.com/', title: '', viewport: { width: 402, height: 714 },
    scroll: { x: 0, y: 0, maxX: 0, maxY: 2000 }, documentSize: { width: 402, height: 2714 },
    htmlBackground: { r: 0, g: 0, b: 0, a: 0 }, bodyBackground: { r: 0, g: 0, b: 0, a: 0 },
    colorScheme: { meta: null, root: 'normal', prefersDark: false }, themeColors: [], manifestHref: null, viewportMeta: null,
    appleWebApp: { capable: false, statusBarStyle: null, title: null }, hasViewportConstrainedObjects: false,
    edges: { top: { kind: 'no-container', hit: null }, right: { kind: 'no-container', hit: null }, bottom: { kind: 'no-container', hit: null }, left: { kind: 'no-container', hit: null } },
    sampleInvalid: { top: [], bottom: [] }, previousContainerVisible: {},
    ...overrides,
  }
}

function capture(edges: FixedEdges, overrides: Partial<PageCapture> = {}, viewportTop = 62): PageCapture {
  const device = findDevice('iphone-17-pro')
  return {
    facts: facts(), edgesAtLoad: edges, edges, underPageBackground: WHITE, manifest: null, contentUnderStatusBar: WHITE, contentUnderToolbar: WHITE, contentBottomEdge: { kind: 'none' },
    layout: {
      screen: device.screen, geometry: device.safari26.portrait, toolbar: 'expanded',
      obscured: { top: 62, bottom: 98, left: 0, right: 0 }, viewportTop, viewportHeight: 714, scrollY: 0,
    },
    images: { viewport: Buffer.alloc(0), above: null, below: null },
    ...overrides,
  }
}

const orangeTop: FixedEdges = { ...NO_EDGES, top: { kind: 'color', color: ORANGE, reason: 'background-color of header', container: 'header', containerId: '1', fromDimmingLayer: false } }

test('a fixed top edge color becomes the top extension', () => {
  const plan = planPanels(capture(orangeTop), INITIAL)
  assert.deepEqual(plan.fills.top, { kind: 'extension', color: ORANGE, fromDimmingLayer: false, reason: 'background-color of header' })
  assert.equal(plan.fills.bottom?.kind, 'content')
})

test('a multiple edge paints the under-page color', () => {
  const edges: FixedEdges = { ...NO_EDGES, top: { kind: 'multiple', reason: 'backdrop-filter', container: 'header', containerId: '1' } }
  const plan = planPanels(capture(edges), INITIAL)
  assert.equal(plan.fills.top?.kind === 'extension' && plan.fills.top.color, WHITE)
})

test('sides without an obscured inset get no fill', () => {
  const plan = planPanels(capture(orangeTop), INITIAL)
  assert.equal(plan.fills.left, null)
})

test('the top extension grows into the rubber-band gap when it differs from the page background', () => {
  const plan = planPanels(capture(orangeTop, {}, 62 + 150), { ...INITIAL, state: 'overscroll-top' })
  assert.equal(plan.topExtensionGrowth, 150)
})

test('the top extension does not grow when it matches the page background', () => {
  const whiteTop: FixedEdges = { ...NO_EDGES, top: { kind: 'color', color: WHITE, reason: 'x', container: 'header', containerId: '1', fromDimmingLayer: false } }
  const plan = planPanels(capture(whiteTop, {}, 62 + 150), { ...INITIAL, state: 'overscroll-top' })
  assert.equal(plan.topExtensionGrowth, 0)
})

test('under-page color composites body over html over white and ignores missing colors', () => {
  assert.deepEqual(underPageBackground(facts(), 'light'), WHITE)
  const red = { r: 255, g: 0, b: 0, a: 1 }
  const halfBlue = { r: 0, g: 0, b: 255, a: 0.5 }
  assert.deepEqual(underPageBackground(facts({ htmlBackground: red, bodyBackground: halfBlue }), 'light'), { r: 128, g: 0, b: 128, a: 1 })
})

test('the first matching theme-color meta wins over the manifest', () => {
  const themed = capture(NO_EDGES, {
    facts: facts({ themeColors: [{ content: 'red', media: '(prefers-color-scheme: dark)', matches: false, color: { r: 255, g: 0, b: 0, a: 1 } }, { content: '#00f', media: null, matches: true, color: { r: 0, g: 0, b: 255, a: 1 } }] }),
    manifest: { theme_color: '#00ff00' },
  })
  assert.deepEqual(activeThemeColor(themed, INITIAL).color, { r: 0, g: 0, b: 255, a: 1 })
  assert.deepEqual(activeThemeColor(capture(NO_EDGES, { manifest: { theme_color: '#00ff00' } }), INITIAL).color, { r: 0, g: 255, b: 0, a: 1 })
})

test('glass turns dark over dark content and stays light over mid-tone content', () => {
  assert.equal(planPanels(capture(NO_EDGES, { contentUnderToolbar: { r: 51, g: 51, b: 51, a: 1 } }), INITIAL).glass, 'dark')
  assert.equal(planPanels(capture(NO_EDGES, { contentUnderToolbar: { r: 0, g: 63, b: 127, a: 1 } }), INITIAL).glass, 'light')
})

test('status bar glyphs turn white over red but stay black over mid green', () => {
  assert.equal(planPanels(capture(NO_EDGES, { contentUnderStatusBar: { r: 255, g: 0, b: 0, a: 1 } }), INITIAL).statusBar, 'light-content')
  assert.equal(planPanels(capture(NO_EDGES, { contentUnderStatusBar: { r: 46, g: 125, b: 50, a: 1 } }), INITIAL).statusBar, 'dark-content')
})

test('the bottom pocket takes the sampled bottom edge color', () => {
  const plan = planPanels(capture(NO_EDGES, { contentBottomEdge: { kind: 'color', color: ORANGE } }), INITIAL)
  assert.deepEqual(plan.fills.bottom?.kind === 'content' && plan.fills.bottom.pocket, { color: ORANGE, strength: 1 })
  assert.equal(plan.glassWhitened, false)
})

test('an unsampleable bottom edge dims content and whitens the glass', () => {
  const imageAtBottom = capture(NO_EDGES, { facts: facts({ sampleInvalid: { top: [], bottom: [null, 'image'] } }), contentBottomEdge: { kind: 'color', color: ORANGE } })
  const plan = planPanels(imageAtBottom, INITIAL)
  assert.equal(plan.fills.bottom?.kind === 'content' && plan.fills.bottom.pocket.color, BLACK)
  assert.equal(plan.glassWhitened, true)
})
