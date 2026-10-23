import { BLACK, colorsAreSimilar, luma, parseSimpleColor, toHex, type Rgba } from './color.ts'
import { hasFixedEdge, type FixedEdge } from './edges.ts'
import { SIDES, type Side } from './page-probe.ts'
import type { PageCapture } from './capture.ts'
import type { Scenario } from './scenario.ts'

/** What Safari paints under one obscured inset. */
export type InsetFill =
  | { readonly kind: 'extension', readonly color: Rgba, readonly fromDimmingLayer: boolean, readonly reason: string }
  | { readonly kind: 'content', readonly pocket: ScrollPocket, readonly reason: string }

/** Color laid over content at a scroll edge; `strength` scales the measured alpha profile. */
export interface ScrollPocket {
  readonly color: Rgba
  readonly strength: number
}

export interface PanelPlan {
  readonly underPageBackground: Rgba
  readonly fills: Readonly<Record<Side, InsetFill | null>>
  /** Extra height the top extension grows by while rubber-banding with the refresh control. */
  readonly topExtensionGrowth: number
  readonly statusBar: 'dark-content' | 'light-content'
  /** Liquid Glass switches to its dark variant over dark content. */
  readonly glass: 'light' | 'dark'
  /** Safari lightens the glass over a container's color extension and over the default dimming pocket, not over a ::backdrop. */
  readonly glassWhitened: boolean
  readonly toolbar: 'expanded' | 'collapsed'
  readonly refreshControl: boolean
  readonly themeColor: { readonly color: Rgba | undefined, readonly source: string, readonly usedByPanels: false }
}

// Fitted on iOS 26.5 Simulator: #795548 (0.359) and green-and-red content (0.38) get white glyphs, #2e7d32 (0.403) black.
const LIGHT_CONTENT_MAX_LUMA = 0.39
// Fitted on iOS 26.5 Simulator swatches: #333333 (0.200) gets dark glass, #003f7f (0.213) light.
export const DARK_GLASS_MAX_LUMA = 0.206
// Fitted on body-gradient: with no sampleable bottom color, content is dimmed to 74% at the bottom edge.
const DEFAULT_BOTTOM_POCKET: ScrollPocket = { color: BLACK, strength: 0.31 }

/**
 * Decides what iOS 26 Safari paints in each obscured inset: `_updateFixedColorExtensionViews` and the scroll pocket.
 * @param capture captured page state
 * @param scenario scroll state, theme and orientation
 * @returns the panel plan to compose
 */
export function planPanels(capture: PageCapture, scenario: Scenario): PanelPlan {
  const { edges, underPageBackground, layout } = capture
  const underPagePocket: ScrollPocket = { color: underPageBackground, strength: 1 }
  const pockets: Record<Side, ScrollPocket> = { top: underPagePocket, left: underPagePocket, right: underPagePocket, bottom: bottomPocket(capture) }
  const fills = Object.fromEntries(SIDES.map(side => [side, insetFill(layout.obscured[side], edges[side], underPageBackground, pockets[side])])) as Record<Side, InsetFill | null>
  const topFill = fills.top
  const bottomFill = fills.bottom
  const topExtensionGrowth = scenario.state === 'overscroll-top' && topFill?.kind === 'extension' && !colorsAreSimilar(underPageBackground, topFill.color)
    ? Math.max(0, layout.viewportTop - layout.obscured.top)
    : 0
  const behindStatusBar = topFill?.kind === 'extension' ? topFill.color : capture.contentUnderStatusBar
  return {
    underPageBackground,
    fills,
    topExtensionGrowth,
    statusBar: luma(behindStatusBar) <= LIGHT_CONTENT_MAX_LUMA ? 'light-content' : 'dark-content',
    glass: luma(bottomFill?.kind === 'extension' ? bottomFill.color : capture.contentUnderToolbar) <= DARK_GLASS_MAX_LUMA ? 'dark' : 'light',
    glassWhitened: bottomFill?.kind === 'extension' ? !bottomFill.fromDimmingLayer : pockets.bottom === DEFAULT_BOTTOM_POCKET,
    toolbar: layout.toolbar,
    refreshControl: scenario.state === 'overscroll-top',
    themeColor: { ...activeThemeColor(capture, scenario), usedByPanels: false },
  }
}

// Like PageColorSampler::sampleTop, any image, canvas, iframe or animation under a sample point voids the sample.
function bottomPocket(capture: PageCapture): ScrollPocket {
  if (capture.facts.sampleInvalid.bottom.some(reason => reason !== null)) return DEFAULT_BOTTOM_POCKET
  const edge = capture.contentBottomEdge
  return { color: edge.kind === 'color' ? edge.color : capture.underPageBackground, strength: 1 }
}

function insetFill(inset: number, edge: FixedEdge, underPage: Rgba, pocket: ScrollPocket): InsetFill | null {
  if (inset <= 0) return null
  if (!hasFixedEdge(edge)) return { kind: 'content', pocket, reason: `${edge.reason}; content scrolls under the glass` }
  if (edge.kind === 'color') return { kind: 'extension', color: edge.color, fromDimmingLayer: edge.fromDimmingLayer, reason: edge.reason }
  return { kind: 'extension', color: underPage, fromDimmingLayer: false, reason: `${edge.reason}; extension uses underPageBackgroundColor ${toHex(underPage)}` }
}

/**
 * `Document::themeColor()`: the first valid theme-color meta whose media matches, else the manifest.
 * @param capture captured page state
 * @param scenario theme decides between `theme_color` and `theme_color_dark`
 * @returns the active theme color and where it came from
 */
export function activeThemeColor(capture: PageCapture, scenario: Scenario): { color: Rgba | undefined, source: string } {
  const meta = capture.facts.themeColors.find(m => m.color && m.matches)
  if (meta?.color) return { color: meta.color, source: `<meta name="theme-color"${meta.media ? ` media="${meta.media}"` : ''} content="${meta.content}">` }
  const manifest = capture.manifest
  const manifestColor = scenario.theme === 'dark' ? manifest?.theme_color_dark ?? manifest?.theme_color : manifest?.theme_color
  if (manifestColor) return { color: parseSimpleColor(manifestColor), source: `manifest ${scenario.theme === 'dark' && manifest?.theme_color_dark ? 'theme_color_dark' : 'theme_color'} ${manifestColor}` }
  return { color: undefined, source: 'none' }
}
