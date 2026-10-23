import { colorsAreSimilar, parseSimpleColor, relativeLuminance, toHex, type Rgba } from './color.ts'
import { hasFixedEdge, type FixedEdge } from './edges.ts'
import { SIDES, type Side } from './page-probe.ts'
import type { PageCapture } from './capture.ts'
import type { Scenario } from './scenario.ts'

/** What Safari paints under one obscured inset. */
export type InsetFill =
  | { readonly kind: 'extension', readonly color: Rgba, readonly reason: string }
  | { readonly kind: 'content', readonly pocketColor: Rgba, readonly reason: string }

export interface PanelPlan {
  readonly underPageBackground: Rgba
  readonly fills: Readonly<Record<Side, InsetFill | null>>
  /** Extra height the top extension grows by while rubber-banding with the refresh control. */
  readonly topExtensionGrowth: number
  readonly statusBar: 'dark-content' | 'light-content'
  readonly toolbar: 'expanded' | 'collapsed'
  readonly refreshControl: boolean
  readonly themeColor: { readonly color: Rgba | undefined, readonly source: string, readonly usedByPanels: false }
}

// Status bar glyphs switch to white only on clearly dark backgrounds.
const LIGHT_CONTENT_MAX_LUMINANCE = 0.18

/**
 * Decides what iOS 26 Safari paints in each obscured inset: `_updateFixedColorExtensionViews` and the scroll pocket.
 * @param capture captured page state
 * @param scenario scroll state, theme and orientation
 * @returns the panel plan to compose
 */
export function planPanels(capture: PageCapture, scenario: Scenario): PanelPlan {
  const { edges, underPageBackground, layout } = capture
  const fills = Object.fromEntries(SIDES.map(side => [side, insetFill(layout.obscured[side], edges[side], underPageBackground)])) as Record<Side, InsetFill | null>
  const topFill = fills.top
  const topExtensionGrowth = scenario.state === 'overscroll-top' && topFill?.kind === 'extension' && !colorsAreSimilar(underPageBackground, topFill.color)
    ? Math.max(0, layout.viewportTop - layout.obscured.top)
    : 0
  const behindStatusBar = topFill?.kind === 'extension' ? topFill.color : underPageBackground
  return {
    underPageBackground,
    fills,
    topExtensionGrowth,
    statusBar: relativeLuminance(behindStatusBar) <= LIGHT_CONTENT_MAX_LUMINANCE ? 'light-content' : 'dark-content',
    toolbar: layout.toolbar,
    refreshControl: scenario.state === 'overscroll-top',
    themeColor: { ...activeThemeColor(capture, scenario), usedByPanels: false },
  }
}

function insetFill(inset: number, edge: FixedEdge, underPage: Rgba): InsetFill | null {
  if (inset <= 0) return null
  if (!hasFixedEdge(edge)) return { kind: 'content', pocketColor: underPage, reason: `${edge.reason}; content scrolls under the glass` }
  if (edge.kind === 'color') return { kind: 'extension', color: edge.color, reason: edge.reason }
  return { kind: 'extension', color: underPage, reason: `${edge.reason}; extension uses underPageBackgroundColor ${toHex(underPage)}` }
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
