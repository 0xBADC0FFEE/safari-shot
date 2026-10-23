import type { Rgba } from './color.ts'

export type Side = 'top' | 'right' | 'bottom' | 'left'
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']

export interface ClientRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** What `LocalFrameView::fixedContainerEdges` finds on one side before colors are resolved. */
export type EdgeProbe =
  | { readonly kind: 'no-container', readonly hit: string | null }
  | {
    readonly kind: 'container'
    readonly container: string
    readonly containerId: string
    readonly foundBackdropFilter: boolean
    readonly isViewportSized: boolean
    readonly isDimmingLayer: boolean
    readonly isSidebar: boolean
    readonly fromBackdrop: boolean
    /** First visible background color on the hit lineage; undefined when none or several differ. */
    readonly backgroundColor: Rgba | undefined
    /** Strip that WebKit snapshots when no background color decides the edge. */
    readonly samplingRect: ClientRect
  }

export type TopSampleInvalidReason = 'image' | 'animation' | 'canvas' | 'iframe'

export interface PageFacts {
  readonly url: string
  readonly title: string
  readonly viewport: { readonly width: number, readonly height: number }
  readonly scroll: { readonly x: number, readonly y: number, readonly maxX: number, readonly maxY: number }
  readonly documentSize: { readonly width: number, readonly height: number }
  readonly htmlBackground: Rgba
  readonly bodyBackground: Rgba | undefined
  readonly colorScheme: { readonly meta: string | null, readonly root: string, readonly prefersDark: boolean }
  readonly themeColors: readonly { readonly content: string, readonly media: string | null, readonly matches: boolean, readonly color: Rgba | undefined }[]
  readonly manifestHref: string | null
  readonly viewportMeta: string | null
  readonly appleWebApp: { readonly capable: boolean, readonly statusBarStyle: string | null, readonly title: string | null }
  readonly hasViewportConstrainedObjects: boolean
  readonly edges: Readonly<Record<Side, EdgeProbe>>
  readonly topSampleInvalid: readonly (TopSampleInvalidReason | null)[]
  /** Whether each previous edge container still renders visibly (headers and footers always count). */
  readonly previousContainerVisible: Readonly<Partial<Record<Side, boolean>>>
}

export interface ProbeOptions {
  /** Size WebKit uses for default (`vh`) viewport units: the large viewport. */
  readonly defaultViewportUnits: { readonly width: number, readonly height: number }
  readonly sides: readonly Side[]
  readonly topSampleCount: number
  readonly previousContainerIds: Readonly<Partial<Record<Side, string>>>
}

/**
 * Runs inside the page (serialized by Playwright): it must not reference anything outside its body.
 * Ports LocalFrameView::fixedContainerEdges up to color resolution, plus the inputs of
 * documentBackgroundColor, theme-color and PageColorSampler::sampleTop.
 */
export function probePage(options: ProbeOptions): PageFacts {
  const SAMPLE_RECT_THICKNESS = 2
  const SAMPLE_RECT_MARGIN = 4
  const THIN_BORDER_WIDTH = 10
  const MINIMUM_RATIO = 0.9
  const MAXIMUM_RATIO = 1.05
  const NEARLY_TRANSPARENT_ALPHA = 0.1
  const ID_ATTRIBUTE = 'data-safari-shot-id'

  type Comparison = 'smaller' | 'similar' | 'larger'
  type Candidate = 'not-fixed' | 'hidden' | 'too-small' | 'too-large' | 'negative-z' | 'viewport-sized' | 'sidebar' | 'dimming' | 'candidate'

  const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  const parseColor = (text: string): Rgba | undefined => {
    const simple = /^rgba?\(([^)]+)\)$/.exec(text.trim())?.[1]
    if (simple) {
      const [r = 0, g = 0, b = 0, a = 1] = simple.split(/[\s,/]+/).filter(Boolean).map(Number)
      return { r, g, b, a }
    }
    if (!CSS.supports('color', text)) return undefined
    canvas.clearRect(0, 0, 1, 1)
    canvas.fillStyle = text
    canvas.fillRect(0, 0, 1, 1)
    const [r = 0, g = 0, b = 0, a = 0] = canvas.getImageData(0, 0, 1, 1).data
    return { r, g, b, a: a / 255 }
  }

  const style = (el: Element) => getComputedStyle(el)
  const describe = (el: Element) => {
    const id = el.id ? `#${el.id}` : ''
    const classes = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : ''
    return `${el.tagName.toLowerCase()}${id}${classes}`
  }
  let nextId = 0
  const identify = (el: Element) => {
    if (!el.hasAttribute(ID_ATTRIBUTE)) el.setAttribute(ID_ATTRIBUTE, String(++nextId + Math.floor(performance.now())))
    return el.getAttribute(ID_ATTRIBUTE)!
  }

  const isFixedOrSticky = (el: Element) => /^(fixed|sticky|-webkit-sticky)$/.test(style(el).position)
  const isBox = (el: Element) => style(el).display !== 'inline' && style(el).display !== 'contents' && style(el).display !== 'none'
  const isReplaced = (el: Element) => /^(IMG|VIDEO|CANVAS|IFRAME|EMBED|OBJECT|INPUT|SELECT|TEXTAREA|BUTTON|svg)$/.test(el.tagName)
  const hasRenderedChild = (el: Element) => [...el.childNodes].some(n =>
    n.nodeType === Node.TEXT_NODE ? n.textContent!.trim() !== '' : n instanceof Element && style(n).display !== 'none')
  const hasBackground = (s: CSSStyleDeclaration) => (parseColor(s.backgroundColor)?.a ?? 0) > 0 || s.backgroundImage !== 'none'
  const hasBackdropFilter = (s: CSSStyleDeclaration) => {
    const value = s.backdropFilter || s.getPropertyValue('-webkit-backdrop-filter')
    return !!value && value !== 'none'
  }
  const isHiddenOrNearlyTransparent = (el: Element) => {
    const s = style(el)
    if (s.visibility !== 'visible' || Number(s.opacity) === 0) return true
    if (Number(s.opacity) < NEARLY_TRANSPARENT_ALPHA) return true
    return !hasBackground(s) && !hasBackdropFilter(s) && !hasRenderedChild(el) && !isReplaced(el)
  }

  const scrollingElement = document.scrollingElement ?? document.documentElement
  const docRect = { x: -scrollX, y: -scrollY, width: scrollingElement.scrollWidth, height: scrollingElement.scrollHeight }
  const layoutViewport = { x: 0, y: 0, width: innerWidth, height: innerHeight }
  const intersect = (a: ClientRect, b: ClientRect): ClientRect => {
    const x = Math.max(a.x, b.x)
    const y = Math.max(a.y, b.y)
    return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) }
  }
  const contract = (r: ClientRect, m: number): ClientRect => ({ x: r.x + m, y: r.y + m, width: r.width - 2 * m, height: r.height - 2 * m })
  const fixedRect = contract(intersect(layoutViewport, docRect), SAMPLE_RECT_MARGIN)

  const lengthOnSide = (side: Side, r: { width: number, height: number }) => side === 'top' || side === 'bottom' ? r.width : r.height
  const adjacentClockwise: Record<Side, Side> = { left: 'top', top: 'right', right: 'bottom', bottom: 'left' }
  const compareWithViewport = (side: Side, el: Element): Comparison => {
    const length = lengthOnSide(side, el.getBoundingClientRect())
    const viewportLength = Math.min(lengthOnSide(side, fixedRect), lengthOnSide(side, options.defaultViewportUnits))
    if (length < viewportLength * MINIMUM_RATIO) return 'smaller'
    if (length < viewportLength * MAXIMUM_RATIO) return 'similar'
    return 'larger'
  }
  const midpoint = (side: Side, r: ClientRect) => ({
    top: { x: r.x + r.width / 2, y: r.y },
    bottom: { x: r.x + r.width / 2, y: r.y + r.height },
    left: { x: r.x, y: r.y + r.height / 2 },
    right: { x: r.x + r.width, y: r.y + r.height / 2 },
  })[side]
  const sampleStrip = (side: Side, r: ClientRect): ClientRect => ({
    top: { x: r.x, y: r.y, width: r.width, height: SAMPLE_RECT_THICKNESS },
    bottom: { x: r.x, y: r.y + r.height - SAMPLE_RECT_THICKNESS, width: r.width, height: SAMPLE_RECT_THICKNESS },
    left: { x: r.x, y: r.y, width: SAMPLE_RECT_THICKNESS, height: r.height },
    right: { x: r.x + r.width - SAMPLE_RECT_THICKNESS, y: r.y, width: SAMPLE_RECT_THICKNESS, height: r.height },
  })[side]

  const primaryBackgroundColor = (side: Side, el: Element, s = style(el)): Rgba | undefined => {
    if (!isBox(el)) return undefined
    const rect = el.getBoundingClientRect()
    if (rect.width <= THIN_BORDER_WIDTH || rect.height <= THIN_BORDER_WIDTH) return undefined
    if (isHiddenOrNearlyTransparent(el)) return undefined
    if (compareWithViewport(side, el) === 'smaller') return undefined
    return parseColor(s.backgroundColor)
  }

  const classify = (side: Side, el: Element): Candidate => {
    if (!isFixedOrSticky(el)) return 'not-fixed'
    const along = compareWithViewport(side, el)
    const adjacent = compareWithViewport(adjacentClockwise[side], el)
    let probablyDimming = false
    if (isBox(el)) {
      if (isHiddenOrNearlyTransparent(el)) return 'hidden'
      const s = style(el)
      probablyDimming = along !== 'smaller' && adjacent !== 'smaller' && hasBackground(s) && !hasRenderedChild(el) && (
        Number(s.opacity) < 1 || ((c => !!c && c.a > 0 && c.a < 1)(primaryBackgroundColor(side, el))))
    }
    if (along === 'smaller') return adjacent !== 'smaller' ? 'sidebar' : 'too-small'
    if (!probablyDimming && adjacent === 'larger') return 'too-large'
    if (probablyDimming) return 'dimming'
    if (along === 'similar' && adjacent === 'similar') {
      const z = parseInt(style(el).zIndex, 10)
      return Number.isFinite(z) && z < 0 ? 'negative-z' : 'viewport-sized'
    }
    return 'candidate'
  }

  const POINTER_EVENTS_STYLE_ID = 'safari-shot-pointer-events'
  const hitTest = (point: { x: number, y: number }, ignorePointerEvents: boolean) => {
    let override: HTMLStyleElement | undefined
    if (ignorePointerEvents) {
      override = document.createElement('style')
      override.id = POINTER_EVENTS_STYLE_ID
      override.textContent = '*, *::before, *::after, *::backdrop { pointer-events: auto !important; }'
      document.documentElement.append(override)
    }
    try {
      return document.elementFromPoint(point.x, point.y)
    } finally {
      override?.remove()
    }
  }

  const isInTopLayer = (el: Element) => {
    const matches = (selector: string) => { try { return el.matches(selector) } catch { return false } }
    return matches(':modal') || matches(':popover-open') || matches(':fullscreen')
  }

  type Found = { probe: EdgeProbe, retryHonoringPointerEvents: boolean }
  const findFixedContainer = (side: Side, ignorePointerEvents: boolean): Found => {
    const hit = hitTest(midpoint(side, fixedRect), ignorePointerEvents)
    if (!hit) return { probe: { kind: 'no-container', hit: null }, retryHonoringPointerEvents: false }

    if (isInTopLayer(hit)) {
      const backdrop = getComputedStyle(hit, '::backdrop')
      const backdropColor = parseColor(backdrop.backgroundColor)
      return {
        retryHonoringPointerEvents: false,
        probe: {
          kind: 'container', container: `${describe(hit)}::backdrop`, containerId: identify(hit),
          foundBackdropFilter: false, isViewportSized: true, isDimmingLayer: true, isSidebar: false, fromBackdrop: true,
          backgroundColor: backdropColor && backdropColor.a >= NEARLY_TRANSPARENT_ALPHA && backdropColor.a > 0 ? backdropColor : undefined,
          samplingRect: sampleStrip(side, fixedRect),
        },
      }
    }

    let multiple = false
    let primary: Rgba | undefined
    let foundBackdropFilter = false
    let hitInvisiblePointerEventsNone = false
    for (let el: Element | null = hit; el && el !== document.documentElement.parentElement; el = el.parentElement) {
      const candidate = classify(side, el)
      if (candidate !== 'hidden') {
        if (hasBackdropFilter(style(el))) foundBackdropFilter = true
        else {
          const color = primaryBackgroundColor(side, el)
          if (color && color.a > 0) {
            if (!primary) primary = color
            else if (primary.r !== color.r || primary.g !== color.g || primary.b !== color.b || primary.a !== color.a) multiple = true
          }
        }
      }
      if (candidate === 'negative-z' || candidate === 'too-large' || candidate === 'hidden') {
        hitInvisiblePointerEventsNone = style(el).pointerEvents === 'none'
        continue
      }
      if (candidate === 'not-fixed' || candidate === 'too-small') continue
      const s = style(el)
      const borderWidth = parseFloat(s.getPropertyValue(`border-${side}-width`)) || 0
      const borderVisible = s.getPropertyValue(`border-${side}-style`) !== 'none' && s.getPropertyValue(`border-${side}-style`) !== 'hidden' && borderWidth > 0
      const strip = sampleStrip(side, fixedRect)
      const offset = borderVisible && borderWidth <= THIN_BORDER_WIDTH ? Math.round(borderWidth) : 0
      const shift = { top: { x: 0, y: offset }, bottom: { x: 0, y: -offset }, left: { x: offset, y: 0 }, right: { x: -offset, y: 0 } }[side]
      return {
        retryHonoringPointerEvents: false,
        probe: {
          kind: 'container', container: describe(el), containerId: identify(el),
          foundBackdropFilter, isViewportSized: candidate === 'viewport-sized', isDimmingLayer: candidate === 'dimming',
          isSidebar: candidate === 'sidebar', fromBackdrop: false,
          backgroundColor: multiple ? undefined : primary,
          samplingRect: { ...strip, x: strip.x + shift.x, y: strip.y + shift.y },
        },
      }
    }
    return { probe: { kind: 'no-container', hit: describe(hit) }, retryHonoringPointerEvents: hitInvisiblePointerEventsNone }
  }

  const hasViewportConstrainedObjects = [...document.querySelectorAll('*')].some(isFixedOrSticky)
  const edges = Object.fromEntries((['top', 'right', 'bottom', 'left'] as const).map(side => {
    if (!hasViewportConstrainedObjects || !options.sides.includes(side)) return [side, { kind: 'no-container', hit: null }]
    let found = findFixedContainer(side, true)
    if (found.retryHonoringPointerEvents) found = findFixedContainer(side, false)
    return [side, found.probe]
  })) as Record<Side, EdgeProbe>

  const topSampleInvalid = Array.from({ length: options.topSampleCount }, (_, i) => {
    const x = Math.min(innerWidth - 1, innerWidth * i / (options.topSampleCount - 1))
    for (const el of document.elementsFromPoint(x, 0)) {
      const s = style(el)
      if (el.tagName === 'IMG' || s.backgroundImage !== 'none') return 'image' as const
      if (el.getAnimations().some(a => a.playState === 'running')) return 'animation' as const
      if (el.tagName === 'CANVAS') return 'canvas' as const
      if (el.tagName === 'IFRAME') return 'iframe' as const
    }
    return null
  })

  const previousContainerVisible = Object.fromEntries(Object.entries(options.previousContainerIds).map(([side, id]) => {
    const el = document.querySelector(`[${ID_ATTRIBUTE}="${id}"]`)
    if (!el || style(el).display === 'none') return [side, false]
    const exempt = (side === 'top' && el.tagName === 'HEADER') || (side === 'bottom' && el.tagName === 'FOOTER')
    return [side, exempt || style(el).visibility === 'visible']
  }))

  const meta = (name: string) => document.querySelector(`meta[name="${name}" i]`)?.getAttribute('content') ?? null
  return {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { x: scrollX, y: scrollY, maxX: scrollingElement.scrollWidth - innerWidth, maxY: scrollingElement.scrollHeight - innerHeight },
    documentSize: { width: scrollingElement.scrollWidth, height: scrollingElement.scrollHeight },
    htmlBackground: parseColor(style(document.documentElement).backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 },
    bodyBackground: document.body ? parseColor(style(document.body).backgroundColor) : undefined,
    colorScheme: { meta: meta('color-scheme'), root: style(document.documentElement).colorScheme, prefersDark: matchMedia('(prefers-color-scheme: dark)').matches },
    themeColors: [...document.querySelectorAll('meta[name="theme-color" i]')].map(m => {
      const media = m.getAttribute('media')
      const content = m.getAttribute('content') ?? ''
      return { content, media, matches: !media || matchMedia(media).matches, color: parseColor(content) }
    }),
    manifestHref: (document.querySelector('link[rel~="manifest"]') as HTMLLinkElement | null)?.href ?? null,
    viewportMeta: meta('viewport'),
    appleWebApp: {
      capable: (meta('apple-mobile-web-app-capable') ?? meta('mobile-web-app-capable')) === 'yes',
      statusBarStyle: meta('apple-mobile-web-app-status-bar-style'),
      title: meta('apple-mobile-web-app-title'),
    },
    hasViewportConstrainedObjects,
    edges,
    topSampleInvalid,
    previousContainerVisible,
  }
}
