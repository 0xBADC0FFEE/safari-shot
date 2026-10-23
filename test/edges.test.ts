import { test } from 'node:test'
import assert from 'node:assert/strict'
import { predominantColor, resolveEdge, NO_EDGES, type FixedEdge, type PredominantColor } from '../src/edges.ts'
import type { EdgeProbe } from '../src/page-probe.ts'
import type { Rgba } from '../src/color.ts'

const PAGE_BG: Rgba = { r: 200, g: 200, b: 200, a: 1 }
const STRIP = { x: 4, y: 4, width: 394, height: 2 }

function strip(colors: [number, number, number, number][], pixelsPerColor: number) {
  return Uint8Array.from(colors.flatMap(c => Array.from({ length: pixelsPerColor }, () => c).flat()))
}

function container(overrides: Partial<Extract<EdgeProbe, { kind: 'container' }>> = {}): EdgeProbe {
  return {
    kind: 'container', container: 'header.bar', containerId: '1',
    foundBackdropFilter: false, isViewportSized: false, isDimmingLayer: false, isSidebar: false, fromBackdrop: false,
    backgroundColor: undefined, samplingRect: STRIP, ...overrides,
  }
}

async function resolve(probe: EdgeProbe, options: { previous?: FixedEdge, previousStillVisible?: boolean, sample?: PredominantColor } = {}) {
  return resolveEdge({
    probe,
    pageBackground: PAGE_BG,
    previous: options.previous ?? NO_EDGES.top,
    previousStillVisible: options.previousStillVisible ?? false,
    sampled: true,
    sample: async () => options.sample ?? { kind: 'none' },
  })
}

test('predominantColor returns the single color of a uniform strip', () => {
  assert.deepEqual(predominantColor(strip([[255, 0, 0, 255]], 600)), { kind: 'color', color: { r: 255, g: 0, b: 0, a: 1 } })
})

test('predominantColor reports multiple when two colors split the strip', () => {
  assert.deepEqual(predominantColor(strip([[255, 0, 0, 255], [0, 0, 255, 255]], 300)), { kind: 'multiple' })
})

test('predominantColor groups similar colors toward the threshold', () => {
  const pixels = strip([[100, 100, 100, 255], [102, 101, 100, 255], [104, 100, 100, 255]], 200)
  assert.equal(predominantColor(pixels).kind, 'color')
})

test('predominantColor ignores fully transparent pixels', () => {
  assert.deepEqual(predominantColor(strip([[0, 0, 0, 0]], 600)), { kind: 'none' })
})

test('a backdrop-filter in the chain makes the edge multiple', async () => {
  const edge = await resolve(container({ foundBackdropFilter: true, backgroundColor: { r: 255, g: 0, b: 0, a: 1 } }))
  assert.equal(edge.kind, 'multiple')
})

test('an opaque background color becomes the edge color', async () => {
  const edge = await resolve(container({ backgroundColor: { r: 255, g: 152, b: 0, a: 1 } }))
  assert.deepEqual(edge.kind === 'color' && edge.color, { r: 255, g: 152, b: 0, a: 1 })
})

test('a background below 0.75 alpha is blended over the page background', async () => {
  const edge = await resolve(container({ backgroundColor: { r: 0, g: 0, b: 0, a: 0.5 } }))
  assert.deepEqual(edge.kind === 'color' && edge.color, { r: 100, g: 100, b: 100, a: 1 })
})

test('a background at 0.8 alpha is clamped to opaque instead of blended', async () => {
  const edge = await resolve(container({ backgroundColor: { r: 0, g: 0, b: 0, a: 0.8 } }))
  assert.deepEqual(edge.kind === 'color' && edge.color, { r: 0, g: 0, b: 0, a: 1 })
})

test('a dimming layer is always blended, even when nearly opaque', async () => {
  const edge = await resolve(container({ isDimmingLayer: true, backgroundColor: { r: 0, g: 0, b: 0, a: 0.9 } }))
  assert.deepEqual(edge.kind === 'color' && edge.color, { r: 20, g: 20, b: 20, a: 1 })
})

test('without a background color the strip is pixel-sampled', async () => {
  const edge = await resolve(container(), { sample: { kind: 'color', color: { r: 10, g: 20, b: 30, a: 1 } } })
  assert.deepEqual(edge.kind === 'color' && edge.color, { r: 10, g: 20, b: 30, a: 1 })
})

test('no container keeps the previous edge while its element is still visible', async () => {
  const previous: FixedEdge = { kind: 'color', color: { r: 1, g: 2, b: 3, a: 1 }, reason: 'background-color of header', container: 'header', containerId: '7', fromDimmingLayer: false }
  const kept = await resolve({ kind: 'no-container', hit: 'p.row' }, { previous, previousStillVisible: true })
  assert.equal(kept.kind, 'color')
  const dropped = await resolve({ kind: 'no-container', hit: 'p.row' }, { previous, previousStillVisible: false })
  assert.equal(dropped.kind, 'none')
})

test('a viewport-sized container keeps the existing edge color', async () => {
  const previous: FixedEdge = { kind: 'color', color: { r: 1, g: 2, b: 3, a: 1 }, reason: 'x', container: 'header', containerId: '7', fromDimmingLayer: false }
  const edge = await resolve(container({ isViewportSized: true, backgroundColor: { r: 255, g: 255, b: 255, a: 1 } }), { previous })
  assert.deepEqual(edge.kind === 'color' && edge.color, { r: 1, g: 2, b: 3, a: 1 })
})
