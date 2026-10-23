import { CHROME_18, LIQUID_GLASS_CHROME, type GlassBand, type GlassName, type Material } from './chrome.ts'
import { BLACK, WHITE, blendSourceOver, colorsAreSimilar, isVisible, withAlpha, luma, parseSimpleColor, toHex, type Rgba } from './color.ts'
import { hasFixedEdge, type FixedEdge, type PredominantColor } from './edges.ts'
import { SIDES, type Side } from './page-probe.ts'
import type { PageCapture } from './capture.ts'
import type { LiquidGlassVersion, Scenario, Theme } from './scenario.ts'

/** What Safari paints under one obscured inset. */
export type InsetFill =
  | { readonly kind: 'extension', readonly color: Rgba, readonly fromDimmingLayer: boolean, readonly reason: string }
  | { readonly kind: 'content', readonly pocket: ScrollPocket, readonly reason: string }

/** Color laid over content at a scroll edge; `strength` scales the measured alpha profile. */
export interface ScrollPocket {
  readonly color: Rgba
  readonly strength: number
}

export type PanelPlan = LiquidGlassPlan | Safari18Plan

export interface LiquidGlassPlan {
  readonly safari: LiquidGlassVersion
  readonly underPageBackground: Rgba
  readonly fills: Readonly<Record<Side, InsetFill | null>>
  /** Extra height the top extension grows by while rubber-banding with the refresh control. */
  readonly topExtensionGrowth: number
  readonly statusBar: StatusBarStyle
  /** Liquid Glass variant the backdrop's luma selects. */
  readonly glass: GlassName
  /** In light appearance Safari lightens the glass over a container's color extension and over the default dimming pocket, not over a ::backdrop. */
  readonly glassWhitened: boolean
  readonly appearance: Theme
  readonly toolbar: 'expanded' | 'collapsed'
  readonly refreshControl: boolean
  readonly themeColor: ThemeColorUse
}

/** Pre-Liquid Glass Safari: a solid tint behind the status bar and an opaque bottom toolbar. */
export interface Safari18Plan {
  readonly safari: '18'
  readonly underPageBackground: Rgba
  /** Fills the status bar band in every scroll state. */
  readonly tint: { readonly color: Rgba, readonly source: 'theme-color' | 'sampled-top' | 'under-page', readonly reason: string }
  /** The collapsed bar's color, laid over content. */
  readonly bottomBar: Rgba
  /** Approximate color of the toolbar's background as shown: material over content, or the collapsed bar over content. */
  readonly toolbarColor: Rgba
  readonly statusBar: StatusBarStyle
  /** Ink of the collapsed bar's host name. */
  readonly bottomBarInk: StatusBarStyle
  readonly material: 'light' | 'dark'
  readonly toolbar: 'expanded' | 'collapsed'
  readonly refreshControl: boolean
  readonly themeColor: ThemeColorUse
}

type StatusBarStyle = 'dark-content' | 'light-content'

interface ThemeColorUse {
  readonly color: Rgba | undefined
  readonly source: string
  readonly usedByPanels: boolean
}

// Fitted on iOS 26.5 Simulator. Light appearance: #795548 (0.359) and green-and-red content (0.38) get white glyphs,
// #2e7d32 (0.403) black. Dark appearance: 80 % orange over #e3f2fd (0.673) white, #00ff00 (0.715) black.
const LIGHT_CONTENT_MAX_LUMA: Readonly<Record<Theme, number>> = { light: 0.39, dark: 0.69 }
// iOS 18.6 Simulator: #808080 (0.502) gets white glyphs, #ff7f7f (0.605) black.
const LIGHT_CONTENT_MAX_LUMA_18 = 0.55
// Fitted on body-gradient: with no sampleable bottom color, content is dimmed to 74% at the bottom edge in light
// appearance and lightened with white at full pocket strength in dark appearance.
const DEFAULT_BOTTOM_POCKET: Readonly<Record<Theme, ScrollPocket>> = { light: { color: BLACK, strength: 0.31 }, dark: { color: WHITE, strength: 1 } }

/**
 * Decides what iOS 26+ Safari paints in each obscured inset: `_updateFixedColorExtensionViews` and the scroll pocket.
 * @param capture captured page state
 * @param scenario scroll state, theme and orientation
 * @param safari Liquid Glass iOS version
 * @returns the panel plan to compose
 */
export function planPanels(capture: PageCapture, scenario: Scenario, safari: LiquidGlassVersion): LiquidGlassPlan {
  const { edges, underPageBackground, layout } = capture
  const underPagePocket: ScrollPocket = { color: underPageBackground, strength: 1 }
  const pockets: Record<Side, ScrollPocket> = { top: underPagePocket, left: underPagePocket, right: underPagePocket, bottom: bottomPocket(capture, scenario.theme) }
  const fills = Object.fromEntries(SIDES.map(side => [side, insetFill(layout.obscured[side], edges[side], underPageBackground, pockets[side])])) as Record<Side, InsetFill | null>
  const topFill = fills.top
  const toolbarFill = fills[layout.geometry.toolbarEdge]
  const topExtensionGrowth = scenario.state === 'overscroll-top' && topFill?.kind === 'extension' && !colorsAreSimilar(underPageBackground, topFill.color)
    ? Math.max(0, layout.viewportTop - layout.obscured.top)
    : 0
  const behindStatusBar = topFill?.kind === 'extension' ? topFill.color : capture.contentUnderStatusBar
  return {
    safari,
    underPageBackground,
    fills,
    topExtensionGrowth,
    statusBar: glyphsOver(behindStatusBar, LIGHT_CONTENT_MAX_LUMA[scenario.theme]),
    glass: glassFor(toolbarFill?.kind === 'extension' ? toolbarFill.color : capture.contentUnderToolbar, LIQUID_GLASS_CHROME[safari].glass.bands[scenario.theme]),
    glassWhitened: scenario.theme === 'light' && (toolbarFill?.kind === 'extension'
      ? !toolbarFill.fromDimmingLayer
      : toolbarFill?.kind === 'content' && toolbarFill.pocket === DEFAULT_BOTTOM_POCKET.light),
    appearance: scenario.theme,
    toolbar: layout.toolbar,
    refreshControl: scenario.state === 'overscroll-top',
    themeColor: { ...activeThemeColor(capture, scenario), usedByPanels: false },
  }
}

/**
 * Decides what iOS 18 Safari paints: the tab-bar tint behind the status bar and the collapsed bar's color.
 * @param capture captured page state
 * @param scenario scroll state and theme
 * @returns the panel plan to compose
 */
export function planPanels18(capture: PageCapture, scenario: Scenario): Safari18Plan {
  const themeColor = activeThemeColor(capture, scenario)
  const tint = tabBarTint(themeColor, capture)
  const bottomEdge = bottomSample(capture)
  const bottomBar = bottomEdge.kind === 'color' ? bottomEdge.color : capture.underPageBackground
  const backdrop = capture.contentUnderToolbar
  const toolbarColor = capture.layout.toolbar === 'expanded'
    ? throughMaterial(backdrop, CHROME_18.material[scenario.theme])
    : blendSourceOver(backdrop, withAlpha(bottomBar, CHROME_18.collapsedBar.opacity))
  return {
    safari: '18',
    underPageBackground: capture.underPageBackground,
    tint,
    bottomBar,
    toolbarColor,
    statusBar: glyphsOver(tint.color, LIGHT_CONTENT_MAX_LUMA_18),
    bottomBarInk: glyphsOver(bottomBar, LIGHT_CONTENT_MAX_LUMA_18),
    material: scenario.theme,
    toolbar: capture.layout.toolbar,
    refreshControl: scenario.state === 'overscroll-top',
    themeColor: { ...themeColor, usedByPanels: tint.source === 'theme-color' },
  }
}

function tabBarTint(themeColor: { color: Rgba | undefined, source: string }, capture: PageCapture): Safari18Plan['tint'] {
  if (themeColor.color && isVisible(themeColor.color)) return { color: themeColor.color, source: 'theme-color', reason: themeColor.source }
  if (capture.sampledPageTopColor) return { color: capture.sampledPageTopColor, source: 'sampled-top', reason: 'the page top is one plain color' }
  return { color: capture.underPageBackground, source: 'under-page', reason: 'no theme-color and the page top cannot be sampled; underPageBackgroundColor' }
}

// The compositor's SVG material filter, applied to one opaque color.
function throughMaterial(color: Rgba, material: Material): Rgba {
  const l = SATURATE_LUMA_WEIGHTS.r * color.r + SATURATE_LUMA_WEIGHTS.g * color.g + SATURATE_LUMA_WEIGHTS.b * color.b
  const channel = (c: number) => Math.round(Math.min(255, Math.max(0, material.scale * (l + material.saturation * (c - l)) + material.offset * 255)))
  return { r: channel(color.r), g: channel(color.g), b: channel(color.b), a: 1 }
}

// feColorMatrix type="saturate"
const SATURATE_LUMA_WEIGHTS = { r: 0.213, g: 0.715, b: 0.072 }

function glassFor(backdrop: Rgba, bands: readonly GlassBand[]): GlassName {
  const backdropLuma = luma(backdrop)
  const band = bands.find(band => backdropLuma <= band.maxLuma)
  if (!band) throw new Error(`no glass band covers luma ${backdropLuma}`)
  return band.name
}

function glyphsOver(color: Rgba, lightContentMaxLuma: number): StatusBarStyle {
  return luma(color) <= lightContentMaxLuma ? 'light-content' : 'dark-content'
}

function bottomPocket(capture: PageCapture, theme: Theme): ScrollPocket {
  const edge = bottomSample(capture)
  if (edge.kind === 'void') return DEFAULT_BOTTOM_POCKET[theme]
  return { color: edge.kind === 'color' ? edge.color : capture.underPageBackground, strength: 1 }
}

// Like PageColorSampler::sampleTop, any image, canvas, iframe or animation under a sample point voids the sample.
function bottomSample(capture: PageCapture): PredominantColor | { readonly kind: 'void' } {
  return capture.facts.sampleInvalid.bottom.some(reason => reason !== null) ? { kind: 'void' } : capture.contentBottomEdge
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
