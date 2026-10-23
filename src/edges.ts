import { blendSourceOver, colorsAreSimilar, isVisible, withAlpha, NEARLY_TRANSPARENT_ALPHA, type Rgba } from './color.ts'
import type { EdgeProbe, Side } from './page-probe.ts'

/** Resolved `FixedContainerEdge` for one side, with the reason it was chosen. */
export type FixedEdge =
  | { readonly kind: 'none', readonly reason: string }
  | { readonly kind: 'multiple', readonly reason: string, readonly container: string, readonly containerId: string }
  | { readonly kind: 'color', readonly color: Rgba, readonly reason: string, readonly container: string, readonly containerId: string, readonly fromDimmingLayer: boolean }

export type FixedEdges = Readonly<Record<Side, FixedEdge>>

export type PredominantColor = { readonly kind: 'none' } | { readonly kind: 'multiple' } | { readonly kind: 'color', readonly color: Rgba }

// LocalFrameView::fixedContainerEdges minimumOpacityThresholdToClampToSolidColor
const SOLID_COLOR_MIN_ALPHA = 0.75
// PageColorSampler::predominantColor
const PREDOMINANT_SAMPLE_COUNT = 29
const PREDOMINANT_MIN_SHARE = 0.67

export const NO_EDGES: FixedEdges = {
  top: { kind: 'none', reason: 'no fixed container' },
  right: { kind: 'none', reason: 'no fixed container' },
  bottom: { kind: 'none', reason: 'no fixed container' },
  left: { kind: 'none', reason: 'no fixed container' },
}

export function hasFixedEdge(edge: FixedEdge) {
  return edge.kind !== 'none'
}

export interface EdgeResolutionInput {
  readonly probe: EdgeProbe
  readonly pageBackground: Rgba
  readonly previous: FixedEdge
  /** Whether the previous container still renders visibly (Page::updateFixedContainerEdges keeps it then). */
  readonly previousStillVisible: boolean
  /** Whether WebKit samples this side now; it skips sides rubber-banded past their edge. */
  readonly sampled: boolean
  readonly sample: () => Promise<PredominantColor>
}

/**
 * Resolves one side the way LocalFrameView::fixedContainerEdges and Page::updateFixedContainerEdges do.
 * @param input probe result, page background, previous edge state and a pixel sampler
 * @returns the fixed edge for that side
 */
export async function resolveEdge(input: EdgeResolutionInput): Promise<FixedEdge> {
  const current = input.sampled ? await resolveSampledEdge(input) : { kind: 'none', reason: 'side not sampled while rubber-banding' } as const
  const keepPrevious = hasFixedEdge(input.previous) && input.previousStillVisible &&
    (!hasFixedEdge(current) || (current.kind !== 'color' && input.previous.kind === 'color'))
  if (keepPrevious) return { ...input.previous, reason: `kept from earlier sampling (${input.previous.reason})` }
  return current
}

async function resolveSampledEdge({ probe, pageBackground, previous, sample }: EdgeResolutionInput): Promise<FixedEdge> {
  if (probe.kind === 'no-container') return { kind: 'none', reason: probe.hit ? `no fixed/sticky ancestor of ${probe.hit}` : 'no fixed/sticky container' }
  const { container, containerId } = probe
  const solid = (color: Rgba, dimming: boolean) =>
    dimming || color.a < SOLID_COLOR_MIN_ALPHA ? blendSourceOver(pageBackground, color) : withAlpha(color, 1)

  if (probe.foundBackdropFilter) return { kind: 'multiple', reason: 'backdrop-filter in the container chain', container, containerId }

  const preferExisting = probe.isDimmingLayer || probe.isViewportSized || probe.isSidebar
  if (preferExisting && previous.kind !== 'none') return { ...previous, reason: `${role(probe)} keeps the existing edge color` }

  if (probe.backgroundColor && isVisible(probe.backgroundColor)) {
    const blended = probe.isDimmingLayer || probe.backgroundColor.a < SOLID_COLOR_MIN_ALPHA
    const source = probe.fromBackdrop ? '::backdrop background-color' : 'background-color'
    return {
      kind: 'color', container, containerId, fromDimmingLayer: probe.isDimmingLayer,
      color: solid(probe.backgroundColor, probe.isDimmingLayer),
      reason: `${source} of ${role(probe)}${blended ? ' blended over the page background' : ''}`,
    }
  }
  if (probe.fromBackdrop) return { kind: 'color', container, containerId, fromDimmingLayer: true, color: pageBackground, reason: 'invisible ::backdrop falls back to the page background' }

  if (previous.kind !== 'none' && 'containerId' in previous && previous.containerId === containerId) {
    return { ...previous, reason: 'same container as last sampling' }
  }

  const sampled = await sample()
  if (sampled.kind === 'none') return { kind: 'none', reason: `pixel sampling of ${container} found nothing visible` }
  if (sampled.kind === 'multiple') return { kind: 'multiple', reason: `pixel sampling of ${container} found no predominant color`, container, containerId }
  return { kind: 'color', container, containerId, fromDimmingLayer: probe.isDimmingLayer, color: solid(sampled.color, probe.isDimmingLayer), reason: `predominant pixel color of ${container}` }
}

function role(probe: Extract<EdgeProbe, { kind: 'container' }>) {
  if (probe.isDimmingLayer) return `dimming layer ${probe.container}`
  if (probe.isViewportSized) return `viewport-sized ${probe.container}`
  if (probe.isSidebar) return `sidebar ${probe.container}`
  return probe.container
}

/**
 * Port of PageColorSampler::predominantColor over unpremultiplied RGBA pixels.
 * @param pixels RGBA bytes of the sampling strip, row-major
 * @returns the predominant color, `multiple`, or `none`
 */
export function predominantColor(pixels: Uint8Array | Buffer): PredominantColor {
  const pixelCount = Math.floor(pixels.length / 4)
  if (pixelCount <= PREDOMINANT_SAMPLE_COUNT) return { kind: 'none' }
  const minimumCount = PREDOMINANT_MIN_SHARE * PREDOMINANT_SAMPLE_COUNT
  const stride = 4 * Math.floor(pixelCount / (PREDOMINANT_SAMPLE_COUNT - 1))
  const distribution = new Map<string, { color: Rgba, count: number }>()
  for (let i = 0; i < pixels.length; i += stride) {
    const color = { r: pixels[i]!, g: pixels[i + 1]!, b: pixels[i + 2]!, a: pixels[i + 3]! / 255 }
    if (!isVisible(color)) continue
    const key = `${color.r},${color.g},${color.b},${pixels[i + 3]}`
    const entry = distribution.get(key)
    if (entry) entry.count++
    else distribution.set(key, { color, count: 1 })
  }
  if (!distribution.size) return { kind: 'none' }
  const nearlyTransparent = (c: Rgba) => c.a < NEARLY_TRANSPARENT_ALPHA
  for (const { color, count } of distribution.values()) {
    if (count > minimumCount) return nearlyTransparent(color) ? { kind: 'none' } : { kind: 'color', color }
  }
  const byFrequency = [...distribution.values()].sort((x, y) => y.count - x.count)
  const [first] = byFrequency
  let total = 0
  for (const { color, count } of byFrequency) {
    if (!colorsAreSimilar(first!.color, color)) continue
    total += count
    if (total > minimumCount) return nearlyTransparent(first!.color) ? { kind: 'none' } : { kind: 'color', color: first!.color }
  }
  return { kind: 'multiple' }
}
