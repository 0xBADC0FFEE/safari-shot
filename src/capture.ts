import type { Browser, BrowserContext, Page } from 'playwright'
import sharp from 'sharp'
import { probePage, SIDES, type PageFacts, type Side, type ClientRect } from './page-probe.ts'
import { resolveEdge, predominantColor, NO_EDGES, type FixedEdges, type PredominantColor } from './edges.ts'
import { blendSourceOver, isVisible, WHITE, BLACK, type Rgba } from './color.ts'
import { screenSize, type DevicePreset, type SafariGeometry } from './devices.ts'
import type { Scenario } from './scenario.ts'

export const IOS_SAFARI_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1'
// PageColorSampler::sampleTop takes this many samples along y=0
const EDGE_SAMPLE_COUNT = 5
const HIDE_ATTRIBUTE = 'data-safari-shot-hide'
const LAYER_ATTRIBUTE = 'data-safari-shot-layer'
const SETTLE_AFTER_SCROLL_MS = 250

export interface CaptureRequest {
  readonly url: string
  readonly device: DevicePreset
  readonly scenario: Scenario
  /** Document scroll offset for the `scrolled` state, in CSS px. */
  readonly scrollY: number
  /** Rubber-band distance for overscroll states, in points. */
  readonly overscroll: number
  /** Extra wait after the load event, in ms. */
  readonly settleMs: number
  /** Overrides the toolbar state the scroll state implies; used to replay simulator references. */
  readonly toolbar?: 'expanded' | 'collapsed'
}

/** Where the page sits on screen, in points. */
export interface PageLayout {
  readonly screen: { readonly width: number, readonly height: number }
  readonly geometry: SafariGeometry
  readonly toolbar: 'expanded' | 'collapsed'
  readonly obscured: Readonly<Record<Side, number>>
  /** Screen y of the layout viewport's top edge, including rubber-band shift. */
  readonly viewportTop: number
  readonly viewportHeight: number
  readonly scrollY: number
}

export interface PageCapture {
  readonly facts: PageFacts
  readonly edgesAtLoad: FixedEdges
  readonly edges: FixedEdges
  readonly underPageBackground: Rgba
  readonly manifest: WebAppManifest | null
  readonly layout: PageLayout
  /** Mean color on screen under the status bar, the under-page color where no content is; glyphs adapt to it. */
  readonly contentUnderStatusBar: Rgba
  /** Mean color on screen under the bottom inset, the under-page color where no content is; glass adapts to it. */
  readonly contentUnderToolbar: Rgba
  /** Predominant color of the page content along the screen's bottom edge; the bottom scroll pocket uses it. */
  readonly contentBottomEdge: PredominantColor
  /** PNGs at device scale: the layout viewport, and document content above and below it. */
  readonly images: {
    readonly viewport: Buffer
    readonly above: Band | null
    readonly below: Band | null
  }
}

/** Document content outside the layout viewport, placed at `top` points from the screen top. */
export interface Band {
  readonly png: Buffer
  readonly top: number
  readonly height: number
}

export interface WebAppManifest {
  readonly theme_color?: string
  readonly theme_color_dark?: string
  readonly background_color?: string
  readonly display?: string
}

/**
 * Loads the page as Safari would lay it out on the device and collects everything the panels depend on.
 * @param browser Playwright browser (WebKit preferred)
 * @param request page, device and scenario
 * @returns page facts, resolved fixed edges and the images to compose
 */
export async function capturePage(browser: Browser, request: CaptureRequest): Promise<PageCapture> {
  const { device, scenario } = request
  const screen = screenSize(device, scenario.orientation)
  const geometry = device.safari26[scenario.orientation]
  const toolbar = request.toolbar ?? (scenario.state === 'scrolled' ? 'collapsed' : 'expanded')
  const viewportHeight = (bottomInset: number) => screen.height - geometry.topInset - bottomInset
  const largeViewport = { width: screen.width - geometry.leftInset - geometry.rightInset, height: viewportHeight(geometry.bottomInsetCollapsed) }

  const context = await browser.newContext({
    viewport: { width: largeViewport.width, height: viewportHeight(geometry.bottomInsetExpanded) },
    deviceScaleFactor: device.scale,
    isMobile: browser.browserType().name() !== 'firefox',
    hasTouch: true,
    userAgent: IOS_SAFARI_USER_AGENT,
    colorScheme: scenario.theme,
  })
  try {
    const page = await context.newPage()
    await page.goto(request.url, { waitUntil: 'load' })
    await page.waitForTimeout(request.settleMs)

    const probe = (previousIds: Partial<Record<Side, string>> = {}) =>
      page.evaluate(probePage, { defaultViewportUnits: largeViewport, sides: [...SIDES], edgeSampleCount: EDGE_SAMPLE_COUNT, previousContainerIds: previousIds })
    const factsAtLoad = await probe()
    const pageBackgroundAtLoad = underPageBackground(factsAtLoad, scenario.theme)
    const edgesAtLoad = await resolveEdges(page, factsAtLoad, pageBackgroundAtLoad, NO_EDGES)

    if (toolbar === 'collapsed') await page.setViewportSize({ width: largeViewport.width, height: largeViewport.height })
    const targetScroll = scenario.state === 'scrolled' ? request.scrollY : scenario.state === 'overscroll-bottom' ? Number.MAX_SAFE_INTEGER : 0
    await page.evaluate(y => scrollTo(0, y), targetScroll)
    await page.waitForTimeout(SETTLE_AFTER_SCROLL_MS)

    const previousIds = Object.fromEntries(SIDES.flatMap(side => {
      const edge = edgesAtLoad[side]
      return 'containerId' in edge ? [[side, edge.containerId]] : []
    }))
    const facts = await probe(previousIds)
    const pageBackground = underPageBackground(facts, scenario.theme)
    const edges = await resolveEdges(page, facts, pageBackground, edgesAtLoad)

    const shift = scenario.state === 'overscroll-top' ? request.overscroll : scenario.state === 'overscroll-bottom' ? -request.overscroll : 0
    const layout: PageLayout = {
      screen, geometry, toolbar,
      obscured: {
        top: geometry.topInset,
        bottom: toolbar === 'collapsed' ? geometry.bottomInsetCollapsed : geometry.bottomInsetExpanded,
        left: geometry.leftInset,
        right: geometry.rightInset,
      },
      viewportTop: geometry.topInset + shift,
      viewportHeight: facts.viewport.height,
      scrollY: facts.scroll.y,
    }
    const images = await captureImages(page, layout, facts)
    const content = await contentOnScreen(images, layout)
    return {
      facts, edgesAtLoad, edges, underPageBackground: pageBackground, manifest: await fetchManifest(context, facts.manifestHref), layout, images,
      contentUnderStatusBar: meanColorOver(content.rows(0, layout.obscured.top), pageBackground),
      contentUnderToolbar: meanColorOver(content.rows(layout.screen.height - layout.obscured.bottom, layout.screen.height), pageBackground),
      contentBottomEdge: predominantColor(content.rows(layout.screen.height - BOTTOM_EDGE_STRIP_PT, layout.screen.height)),
    }
  } finally {
    await context.close()
  }
}

/**
 * `underPageBackgroundColor`: html then body background over the base view color; images are ignored.
 * @param facts page facts
 * @param theme system appearance, which decides the base view color
 * @returns the opaque under-page color
 */
export function underPageBackground(facts: PageFacts, theme: Scenario['theme']): Rgba {
  const base = theme === 'dark' && facts.colorScheme.root.includes('dark') ? BLACK : WHITE
  const html = facts.htmlBackground
  const body = facts.bodyBackground
  if (!isVisible(html) && !(body && isVisible(body))) return base
  const withHtml = isVisible(html) ? blendSourceOver(base, html) : base
  return body && isVisible(body) ? blendSourceOver(withHtml, body) : withHtml
}

async function resolveEdges(page: Page, facts: PageFacts, pageBackground: Rgba, previous: FixedEdges): Promise<FixedEdges> {
  const entries = []
  for (const side of SIDES) {
    const probe = facts.edges[side]
    entries.push([side, await resolveEdge({
      probe,
      pageBackground,
      previous: previous[side],
      previousStillVisible: facts.previousContainerVisible[side] ?? false,
      sampled: true,
      sample: () => probe.kind === 'container' ? sampleFixedLayers(page, probe.samplingRect) : Promise.resolve({ kind: 'none' }),
    })] as const)
  }
  return Object.fromEntries(entries) as Record<Side, FixedEdges[Side]>
}

/**
 * Emulates `PageColorSampler::predominantColor`: snapshots only fixed and sticky layers, without text or replaced content.
 * @param page page to sample
 * @param rect sampling strip in CSS px, viewport coordinates
 * @returns the predominant color of the strip
 */
async function sampleFixedLayers(page: Page, rect: ClientRect): Promise<PredominantColor> {
  if (rect.width <= 0 || rect.height <= 0) return { kind: 'none' }
  const styleId = await page.evaluate(([layerAttribute]) => {
    for (const el of document.querySelectorAll('*')) {
      if (/^(fixed|sticky|-webkit-sticky)$/.test(getComputedStyle(el).position)) el.setAttribute(layerAttribute!, '')
    }
    const style = document.createElement('style')
    style.id = 'safari-shot-sampling'
    style.textContent = `
      html, body { background: transparent !important; }
      * { visibility: hidden !important; color: transparent !important; -webkit-text-fill-color: transparent !important;
          text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }
      [${layerAttribute}], [${layerAttribute}] * { visibility: visible !important; }
      img, video, canvas, svg, embed, object, picture { visibility: hidden !important; }`
    document.documentElement.append(style)
    return style.id
  }, [LAYER_ATTRIBUTE])
  try {
    const png = await page.screenshot({ clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, omitBackground: true, animations: 'disabled' })
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return predominantColor(data)
  } catch {
    return { kind: 'none' }
  } finally {
    await page.evaluate(id => document.getElementById(id)?.remove(), styleId)
  }
}

async function captureImages(page: Page, layout: PageLayout, facts: PageFacts): Promise<PageCapture['images']> {
  const viewport = await page.screenshot({ animations: 'disabled', caret: 'hide' })
  const { width } = facts.viewport
  const aboveHeight = Math.max(0, layout.viewportTop)
  const belowTop = layout.viewportTop + layout.viewportHeight
  const belowHeight = Math.max(0, layout.screen.height - belowTop)
  const scrollY = facts.scroll.y
  const documentHeight = facts.documentSize.height

  await setFixedLayersHidden(page, true)
  try {
    let above: Band | null = null
    const aboveStart = Math.max(0, scrollY - aboveHeight)
    if (aboveHeight > 0 && scrollY > aboveStart) {
      const scrolled = await scrollToY(page, aboveStart)
      const height = scrollY - scrolled
      const png = await page.screenshot({ clip: { x: 0, y: 0, width, height }, animations: 'disabled', caret: 'hide' })
      above = { png, top: layout.viewportTop - height, height }
    }
    let below: Band | null = null
    const belowStart = scrollY + layout.viewportHeight
    const belowEnd = Math.min(documentHeight, belowStart + belowHeight)
    if (belowHeight > 0 && belowEnd > belowStart) {
      const scrolled = await scrollToY(page, belowEnd - layout.viewportHeight)
      const offset = belowStart - scrolled
      const height = belowEnd - belowStart
      const png = await page.screenshot({ clip: { x: 0, y: offset, width, height }, animations: 'disabled', caret: 'hide' })
      below = { png, top: belowTop, height }
    }
    await scrollToY(page, scrollY)
    return { viewport, above, below }
  } finally {
    await setFixedLayersHidden(page, false)
  }
}

// PageColorSampler strips are 2px thick.
const BOTTOM_EDGE_STRIP_PT = 2

async function contentOnScreen(images: PageCapture['images'], layout: PageLayout) {
  const { height: viewportPixels = 0 } = await sharp(images.viewport).metadata()
  const scale = viewportPixels / layout.viewportHeight
  const width = Math.round(layout.screen.width * scale)
  const height = Math.round(layout.screen.height * scale)
  const left = Math.round(layout.geometry.leftInset * scale)
  const placed = [
    { png: images.viewport, top: layout.viewportTop },
    ...[images.above, images.below].filter(band => band !== null).map(band => ({ png: band.png, top: band.top })),
  ]
  const composites = await Promise.all(placed.map(async ({ png, top }) => {
    const pixelTop = Math.round(top * scale)
    const { width: imageWidth = 0, height: imageHeight = 0 } = await sharp(png).metadata()
    const skip = Math.max(0, -pixelTop)
    const visible = Math.min(imageHeight, height - pixelTop) - skip
    if (visible <= 0) return null
    const input = await sharp(png).extract({ left: 0, top: skip, width: Math.min(width - left, imageWidth), height: visible }).toBuffer()
    return { input, top: pixelTop + skip, left }
  }))
  const data = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites.filter(c => c !== null)).raw().toBuffer()
  return {
    rows: (fromPt: number, toPt: number) => data.subarray(Math.round(fromPt * scale) * width * 4, Math.round(toPt * scale) * width * 4),
  }
}

function meanColorOver(rgba: Uint8Array, background: Rgba): Rgba {
  let r = 0, g = 0, b = 0
  const count = rgba.length / 4
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3]! / 255
    r += rgba[i]! * alpha + background.r * (1 - alpha)
    g += rgba[i + 1]! * alpha + background.g * (1 - alpha)
    b += rgba[i + 2]! * alpha + background.b * (1 - alpha)
  }
  return count ? { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count), a: 1 } : background
}

async function scrollToY(page: Page, y: number) {
  return page.evaluate(target => {
    scrollTo(0, target)
    return scrollY
  }, y)
}

async function setFixedLayersHidden(page: Page, hidden: boolean) {
  await page.evaluate(([attribute, hide]) => {
    const styleId = 'safari-shot-hide-fixed'
    if (!hide) {
      document.getElementById(styleId)?.remove()
      for (const el of document.querySelectorAll(`[${attribute}]`)) el.removeAttribute(attribute as string)
      return
    }
    for (const el of document.querySelectorAll('*')) {
      if (/^(fixed|sticky|-webkit-sticky)$/.test(getComputedStyle(el).position)) el.setAttribute(attribute as string, '')
    }
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `[${attribute}] { visibility: hidden !important; }`
    document.documentElement.append(style)
  }, [HIDE_ATTRIBUTE, hidden] as const)
}

async function fetchManifest(context: BrowserContext, href: string | null): Promise<WebAppManifest | null> {
  if (!href) return null
  try {
    const response = await context.request.get(href)
    return response.ok() ? await response.json() as WebAppManifest : null
  } catch {
    return null
  }
}
