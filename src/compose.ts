import type { Browser } from 'playwright'
import { toCss, type Rgba } from './color.ts'
import type { PageCapture, Band } from './capture.ts'
import type { PanelPlan, ScrollPocket } from './model.ts'
import { CHROME_26, type Chrome26, type GlassVariant } from './chrome.ts'
import type { DevicePreset, StatusBarLayout } from './devices.ts'

export interface ComposeInput {
  readonly capture: PageCapture
  readonly plan: PanelPlan
  readonly device: DevicePreset
  readonly hostLabel: string
}

// Virtual origin the compositor page loads its images from, so clones reuse one decoded image.
const ASSET_ORIGIN = 'https://safari-shot.invalid'

interface GlassShape {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly radius: number
  readonly inner: string
}

/**
 * Renders the final screenshot: page content placed on screen plus Safari's panels drawn over it.
 * @param browser browser used as the compositor
 * @param input capture, panel plan and device
 * @returns PNG at device pixels
 */
export async function composeScreenshot(browser: Browser, input: ComposeInput): Promise<Buffer> {
  const { screen } = input.capture.layout
  const context = await browser.newContext({ viewport: screen, deviceScaleFactor: input.device.scale })
  try {
    const assets = new Map<string, { body: Buffer | string, contentType: string }>([
      ['/index.html', { body: composeHtml(input), contentType: 'text/html; charset=utf-8' }],
      ...imageAssets(input.capture).map(([path, png]) => [path, { body: png, contentType: 'image/png' }] as const),
    ])
    await context.route(`${ASSET_ORIGIN}/**`, route => {
      const asset = assets.get(new URL(route.request().url()).pathname)
      return asset ? route.fulfill({ status: 200, body: asset.body, contentType: asset.contentType }) : route.fulfill({ status: 404 })
    })
    const page = await context.newPage()
    await page.goto(`${ASSET_ORIGIN}/index.html`, { waitUntil: 'load' })
    // WebKit decodes large images asynchronously and can screenshot before painting them;
    // decoding="sync" on every <img> plus this wait keeps them in the frame.
    await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map(i => i.decode())]).then(() => undefined))
    return await page.screenshot({ animations: 'disabled' })
  } finally {
    await context.close()
  }
}

function imageAssets({ images }: PageCapture): [string, Buffer][] {
  return [
    ['/viewport.png', images.viewport] as [string, Buffer],
    ...(images.above ? [['/above.png', images.above.png] as [string, Buffer]] : []),
    ...(images.below ? [['/below.png', images.below.png] as [string, Buffer]] : []),
  ]
}

/**
 * Builds the compositor document. Images load from {@link ASSET_ORIGIN}.
 * @param input capture, panel plan and device
 * @returns HTML for the compositor page
 */
export function composeHtml({ capture, plan, device, hostLabel }: ComposeInput): string {
  const { layout, images } = capture
  const { screen, obscured } = layout
  const chrome = CHROME_26
  const contentLeft = obscured.left
  const viewportWidth = screen.width - obscured.left - obscured.right
  const img = (path: string, top: number, height: number) =>
    `<img src="${path}" decoding="sync" style="position:absolute;left:${contentLeft}px;top:${top}px;width:${viewportWidth}px;height:${height}px">`
  const band = (path: string, b: Band | null) => b ? img(path, b.top, b.height) : ''

  const topPocketColor = plan.fills.top?.kind === 'extension' ? plan.fills.top.color : plan.underPageBackground
  const under = [
    `<div style="position:absolute;inset:0;background:${toCss(plan.underPageBackground)}"></div>`,
    band('/above.png', images.above),
    img('/viewport.png', layout.viewportTop, layout.viewportHeight),
    band('/below.png', images.below),
    extension(plan.fills.top, 0, obscured.top + plan.topExtensionGrowth, screen.width),
    extension(plan.fills.bottom, screen.height - obscured.bottom, obscured.bottom, screen.width),
    obscured.top > 0 ? topPocket(topPocketColor, screen.width, obscured.top, chrome) : '',
    plan.toolbar === 'expanded' && plan.fills.bottom?.kind === 'content' ? bottomPocket(plan.fills.bottom.pocket, screen, chrome) : '',
  ].join('')
  const variant = chrome.glass[plan.glass]
  const shapes = toolbarShapes(layout, device, hostLabel, chrome, variant)

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${screen.width}px; height: ${screen.height}px; overflow: hidden; }
    body { position: relative; font-family: ${chrome.fontFamily}; -webkit-font-smoothing: antialiased; }
    .layer { position: absolute; left: 0; top: 0; width: ${screen.width}px; height: ${screen.height}px; overflow: hidden; }
    .glass { position: absolute; overflow: hidden; box-shadow: ${chrome.glass.shadow}; }
    .glass > .refraction { filter: url(#glass); }
    .glass > .inner { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .glass::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: ${variant.rim}; }
  </style></head><body>
    ${glassFilter(chrome, variant, plan.glassWhitened)}
    <div class="layer">${under}</div>
    ${plan.refreshControl ? spinner(screen.width / 2, obscured.top + chrome.refreshSpinner.offsetTop, plan.statusBar) : ''}
    ${layout.geometry.statusBarVisible ? statusBar(screen.width, plan.statusBar, device.statusBar) : ''}
    ${shapes.map(shape => glass(shape, under)).join('\n')}
  </body></html>`
}

function glassFilter(chrome: Chrome26, variant: GlassVariant, whitened: boolean) {
  const colorMatrix = whitened ? mixWithWhite(variant.colorMatrix, chrome.glass.whitenedMix) : variant.colorMatrix
  const matrix = colorMatrix.map(n => n.toFixed(4)).join(' ')
  return `<svg width="0" height="0" style="position:absolute"><filter id="glass" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feGaussianBlur stdDeviation="${chrome.glass.blur}"/><feColorMatrix type="matrix" values="${matrix}"/></filter></svg>`
}

const MATRIX_COLUMNS = 5
const OFFSET_COLUMN = 4
const ALPHA_ROW_START = 15

function mixWithWhite(matrix: readonly number[], share: number) {
  return matrix.map((n, i) => {
    if (i >= ALPHA_ROW_START) return n
    return n * (1 - share) + (i % MATRIX_COLUMNS === OFFSET_COLUMN ? share : 0)
  })
}

function glass(shape: GlassShape, under: string) {
  return `<div class="glass" style="left:${shape.left}px;top:${shape.top}px;width:${shape.width}px;height:${shape.height}px;border-radius:${shape.radius}px">
    <div class="layer refraction" style="left:${-shape.left}px;top:${-shape.top}px">${under}</div>
    <div class="inner">${shape.inner}</div>
  </div>`
}

function extension(fill: PanelPlan['fills']['top'], top: number, height: number, width: number) {
  if (fill?.kind !== 'extension' || height <= 0) return ''
  return `<div style="position:absolute;left:0;top:${top}px;width:${width}px;height:${height}px;background:${toCss(fill.color)}"></div>`
}

function topPocket(color: Rgba, width: number, topInset: number, chrome: Chrome26) {
  const { alphaStops, measuredTopInset } = chrome.topPocket
  // Measured on one status bar height only; other devices assume the fade scales with it.
  const scale = topInset / measuredTopInset
  const height = alphaStops.at(-1)![0] * scale
  const gradient = alphaStops.map(([distance, alpha]) => `${rgba(color, alpha)} ${distance * scale}px`).join(', ')
  return `<div style="position:absolute;left:0;top:0;width:${width}px;height:${height}px;background:linear-gradient(to bottom, ${gradient})"></div>`
}

function bottomPocket(pocket: ScrollPocket, screen: { width: number, height: number }, chrome: Chrome26) {
  const stops = chrome.bottomPocket.alphaStops
  const height = stops.at(-1)![0]
  const gradient = stops.map(([distance, alpha]) => `${rgba(pocket.color, alpha * pocket.strength)} ${distance}px`).join(', ')
  return `<div style="position:absolute;left:0;top:${screen.height - height}px;width:${screen.width}px;height:${height}px;background:linear-gradient(to top, ${gradient})"></div>`
}

function rgba(color: Rgba, alpha: number) {
  return toCss({ ...color, a: alpha })
}

function glyphColor(style: PanelPlan['statusBar']) {
  return style === 'light-content' ? '#ffffff' : '#000000'
}

function statusBar(width: number, style: PanelPlan['statusBar'], layout: StatusBarLayout) {
  const color = glyphColor(style)
  const glyphs = statusGlyphs(color, layout.fontSize / REFERENCE_FONT_SIZE)
  const icon = (svg: string, left: number) => `<div style="position:absolute;left:${left}px;top:${layout.iconsCenterY}px;transform:translateY(-50%);display:flex">${svg}</div>`
  const time = (centerX: number) => `<div style="position:absolute;left:${centerX - 40}px;width:80px;top:${layout.timeBaseline - layout.fontSize}px;height:${layout.fontSize}px;line-height:${layout.fontSize}px;text-align:center;font-size:${layout.fontSize}px;font-weight:600;letter-spacing:-0.2px">9:41</div>`
  const parts = layout.kind === 'split'
    ? [time(layout.timeCenterX), icon(glyphs.signal + glyphs.wifi + glyphs.battery, width - layout.trailingInset - glyphs.width.all)]
    : [icon(glyphs.signal + glyphs.wifi, layout.sideInset), time(width / 2), icon(glyphs.battery, width - layout.sideInset - glyphs.width.battery)]
  return `<div style="position:absolute;left:0;top:0;width:${width}px;color:${color}">${parts.join('')}</div>`
}

// Glyph artwork is drawn for the 17pt status bar of Dynamic Island iPhones and scaled for the others.
const REFERENCE_FONT_SIZE = 17

function statusGlyphs(color: string, scale: number) {
  const svg = (width: number, gapAfter: number, body: string) => `<svg width="${width * scale}" height="${13 * scale}" viewBox="0 0 ${width} 13" fill="${color}" style="margin-right:${gapAfter * scale}px">${body}</svg>`
  const width = { signal: 18.2, wifi: 15.4, battery: 28.3 }
  const gap = { signal: 5.6, wifi: 11.3 }
  return {
    width: { all: (width.signal + gap.signal + width.wifi + gap.wifi + width.battery) * scale, battery: width.battery * scale },
    signal: svg(width.signal, gap.signal, `<rect x="0" y="8.3" width="3.2" height="4.4" rx="0.9"/><rect x="5" y="5.9" width="3.2" height="6.8" rx="0.9"/>
      <rect x="10" y="3.4" width="3.2" height="9.3" rx="0.9"/><rect x="15" y="0.8" width="3.2" height="11.9" rx="0.9"/>`),
    wifi: svg(width.wifi, gap.wifi, `<path transform="translate(-23.8 0)" d="M31.5 2.6c2.4 0 4.6.9 6.3 2.5l1.2-1.2C37 1.9 34.4.8 31.5.8s-5.5 1.1-7.5 3.1l1.2 1.2c1.7-1.6 3.9-2.5 6.3-2.5zm0 3.6c1.4 0 2.7.5 3.7 1.5l1.2-1.2c-1.4-1.3-3.1-2.1-4.9-2.1s-3.5.8-4.9 2.1l1.2 1.2c1-1 2.3-1.5 3.7-1.5zm0 3.5c-.6 0-1.1.2-1.5.6l1.5 1.5 1.5-1.5c-.4-.4-.9-.6-1.5-.6z"/>`),
    battery: svg(width.battery, 0, `<g transform="translate(-50.5 0)"><rect x="51.3" y="0.8" width="24.4" height="11.5" rx="3.6" fill="none" stroke="${color}" stroke-opacity="0.4" stroke-width="1"/>
      <rect x="53.2" y="2.7" width="20.6" height="7.7" rx="2.1"/><path d="M76.9 4.6v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" fill-opacity="0.4"/></g>`),
  }
}

function toolbarShapes(layout: PageCapture['layout'], device: DevicePreset, hostLabel: string, chrome: Chrome26, variant: GlassVariant): GlassShape[] {
  const { screen, toolbar } = layout
  if (layout.geometry.toolbarEdge === 'top') return toolbar === 'expanded' ? landscapeToolbar(screen, device.safeArea.landscape.side, hostLabel, chrome, variant) : []
  return toolbar === 'expanded' ? expandedToolbar(screen, hostLabel, chrome, variant) : collapsedToolbar(screen, hostLabel, chrome, variant)
}

function landscapeToolbar(screen: { width: number }, safeAreaSide: number, hostLabel: string, chrome: Chrome26, variant: GlassVariant): GlassShape[] {
  const t = chrome.toolbarLandscape
  const ink = variant.ink
  const side = safeAreaSide + t.safeAreaGap
  const circle = (left: number, inner: string): GlassShape => ({ left, top: t.top, width: t.height, height: t.height, radius: t.height / 2, inner })
  const icon = (path: string) => `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
  const groupWidth = t.groupButtons * t.height
  const pillLeft = (screen.width - t.urlPillWidth) / 2
  return [
    circle(side, `<svg width="12" height="20" viewBox="0 0 12 20"><path d="M10 2 2 10l8 8" fill="none" stroke="${variant.disabledInk}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
    circle(side + t.height + t.gap, icon('<path d="M11 5.5C9 4 6 3.6 2.5 4.2v13C6 16.6 9 17 11 18.5c2-1.5 5-1.9 8.5-1.3v-13C16 3.6 13 4 11 5.5zM11 5.5v13"/>')),
    {
      left: pillLeft, top: t.top, width: t.urlPillWidth, height: t.height, radius: t.height / 2,
      inner: `<svg style="position:absolute;left:12px;top:${t.height / 2 - 9}px" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round">
          <rect x="2" y="1.5" width="14" height="8.5" rx="2"/><path d="M2 13.2h14M2 16.4h9"/></svg>
        <span style="font-size:${t.fontSize}px;font-weight:500;color:${ink};letter-spacing:-0.3px;white-space:nowrap;max-width:${t.urlPillWidth - 90}px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(hostLabel)}</span>
        <svg style="position:absolute;right:12px;top:${t.height / 2 - 10}px" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15.6 7.2A6.6 6.6 0 1 0 16.6 11"/><path d="M16.2 2.6v4.8h-4.8"/></svg>`,
    },
    {
      left: screen.width - side - groupWidth, top: t.top, width: groupWidth, height: t.height, radius: t.height / 2,
      inner: [
        icon('<path d="M11 2.5v11M7 6.5l4-4 4 4M6.5 9.5H5v10h12v-10h-1.5"/>'),
        icon('<path d="M11 4v14M4 11h14"/>'),
        icon('<rect x="6.5" y="6.5" width="12" height="12" rx="2.5"/><path d="M15.5 3.5h-9a3 3 0 0 0-3 3v9"/>'),
      ].map(svg => `<div style="width:${t.height}px;display:flex;justify-content:center">${svg}</div>`).join(''),
    },
  ]
}

function expandedToolbar(screen: { width: number, height: number }, hostLabel: string, chrome: Chrome26, variant: GlassVariant): GlassShape[] {
  const t = chrome.toolbarExpanded
  const top = screen.height - t.bottomMargin - t.height
  const pillLeft = t.sideMargin + t.height + t.gap
  const pillWidth = screen.width - 2 * pillLeft
  const ink = variant.ink
  const circle = (left: number, inner: string): GlassShape => ({ left, top, width: t.height, height: t.height, radius: t.height / 2, inner })
  return [
    circle(t.sideMargin, `<svg width="12" height="20" viewBox="0 0 12 20"><path d="M10 2 2 10l8 8" fill="none" stroke="${variant.disabledInk}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
    {
      left: pillLeft, top, width: pillWidth, height: t.height, radius: t.height / 2,
      inner: `<svg style="position:absolute;left:${t.pageMenuIconLeft}px;top:${t.height / 2 - 9}px" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round">
          <rect x="2" y="1.5" width="14" height="8.5" rx="2"/><path d="M2 13.2h14M2 16.4h9"/></svg>
        <span style="font-size:${t.fontSize}px;font-weight:500;color:${ink};letter-spacing:-0.3px;white-space:nowrap;max-width:${pillWidth - 90}px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(hostLabel)}</span>
        <svg style="position:absolute;right:${t.reloadIconRight}px;top:${t.height / 2 - 10}px" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15.6 7.2A6.6 6.6 0 1 0 16.6 11"/><path d="M16.2 2.6v4.8h-4.8"/></svg>`,
    },
    circle(screen.width - t.sideMargin - t.height, `<svg width="22" height="6" viewBox="0 0 22 6" fill="${ink}"><circle cx="3" cy="3" r="2.4"/><circle cx="11" cy="3" r="2.4"/><circle cx="19" cy="3" r="2.4"/></svg>`),
  ]
}

function collapsedToolbar(screen: { width: number, height: number }, hostLabel: string, chrome: Chrome26, variant: GlassVariant): GlassShape[] {
  const t = chrome.toolbarCollapsed
  const width = Math.round(textWidth(hostLabel, t.fontSize) + 2 * t.paddingX)
  return [{
    left: (screen.width - width) / 2, top: screen.height - t.bottomMargin - t.height, width, height: t.height, radius: t.height / 2,
    inner: `<span style="font-size:${t.fontSize}px;font-weight:500;color:${variant.ink};letter-spacing:-0.2px;white-space:nowrap">${escapeHtml(hostLabel)}</span>`,
  }]
}

// Average SF Pro advance width per em for lowercase host names; the pill is sized before layout.
const AVERAGE_ADVANCE_EM = 0.545

function textWidth(text: string, fontSize: number) {
  return text.length * fontSize * AVERAGE_ADVANCE_EM
}

function spinner(centerX: number, centerY: number, style: PanelPlan['statusBar']) {
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const opacity = 0.25 + 0.75 * (i / 7)
    return `<rect x="-1.4" y="-11" width="2.8" height="7" rx="1.4" transform="rotate(${i * 45})" fill-opacity="${opacity.toFixed(2)}"/>`
  }).join('')
  const color = style === 'light-content' ? '#ffffff' : '#8e8e93'
  return `<svg style="position:absolute;left:${centerX - 12}px;top:${centerY - 12}px" width="24" height="24" viewBox="-12 -12 24 24" fill="${color}">${spokes}</svg>`
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}
