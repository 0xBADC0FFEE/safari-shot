import type { Browser } from 'playwright'
import { toCss, type Rgba } from './color.ts'
import type { PageCapture, Band } from './capture.ts'
import type { PanelPlan } from './model.ts'
import { CHROME_26, type Chrome26 } from './chrome.ts'
import type { DevicePreset } from './devices.ts'

export interface ComposeInput {
  readonly capture: PageCapture
  readonly plan: PanelPlan
  readonly device: DevicePreset
  readonly hostLabel: string
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
    const page = await context.newPage()
    await page.setContent(composeHtml(input), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    return await page.screenshot({ animations: 'disabled' })
  } finally {
    await context.close()
  }
}

/**
 * Builds the compositor document.
 * @param input capture, panel plan and device
 * @returns self-contained HTML
 */
export function composeHtml({ capture, plan, hostLabel }: ComposeInput): string {
  const { layout, images } = capture
  const { screen, obscured } = layout
  const chrome = CHROME_26
  const contentLeft = layout.geometry.leftInset
  const viewportWidth = screen.width - layout.geometry.leftInset - layout.geometry.rightInset
  const img = (png: Buffer, top: number, height: number) =>
    `<img src="data:image/png;base64,${png.toString('base64')}" style="position:absolute;left:${contentLeft}px;top:${top}px;width:${viewportWidth}px;height:${height}px">`
  const band = (b: Band | null) => b ? img(b.png, b.top, b.height) : ''

  const topExtensionHeight = obscured.top + plan.topExtensionGrowth
  const layers = [
    `<div id="content" style="position:absolute;inset:0;overflow:hidden">${band(images.above)}${img(images.viewport, layout.viewportTop, layout.viewportHeight)}${band(images.below)}</div>`,
    insetLayer('top', plan.fills.top, 0, topExtensionHeight, screen.width, chrome),
    insetLayer('bottom', plan.fills.bottom, screen.height - obscured.bottom, obscured.bottom, screen.width, chrome),
    plan.refreshControl ? spinner(screen.width / 2, obscured.top + chrome.refreshSpinner.offsetTop, plan.statusBar) : '',
    statusBar(screen.width, plan.statusBar, chrome),
    plan.toolbar === 'expanded' ? expandedToolbar(screen, hostLabel, chrome) : collapsedToolbar(screen, hostLabel, chrome),
  ]
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${screen.width}px; height: ${screen.height}px; overflow: hidden; }
    body { position: relative; background: ${toCss(plan.underPageBackground)}; font-family: ${chrome.fontFamily}; -webkit-font-smoothing: antialiased; }
    .glass { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
      backdrop-filter: ${chrome.glass.backdropFilter}; -webkit-backdrop-filter: ${chrome.glass.backdropFilter};
      background: ${chrome.glass.tint}; box-shadow: ${chrome.glass.shadow}; }
    .glass::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: ${chrome.glass.rim}; pointer-events: none; }
  </style></head><body>${layers.join('\n')}</body></html>`
}

function insetLayer(side: 'top' | 'bottom', fill: PanelPlan['fills']['top'], top: number, height: number, width: number, chrome: Chrome26) {
  if (!fill || height <= 0) return ''
  if (fill.kind === 'extension') return `<div style="position:absolute;left:0;top:${top}px;width:${width}px;height:${height}px;background:${toCss(fill.color)}"></div>`
  const pocket = side === 'top' ? chrome.topPocket : chrome.bottomPocket
  const pocketHeight = height + pocket.overhang
  const pocketTop = side === 'top' ? top : top - pocket.overhang
  const stops = pocket.alphaStops.map(([offset, alpha]) => `${rgba(fill.pocketColor, alpha)} ${(offset * 100).toFixed(1)}%`).join(', ')
  const direction = side === 'top' ? 'to bottom' : 'to top'
  return `<div style="position:absolute;left:0;top:${pocketTop}px;width:${width}px;height:${pocketHeight}px;background:linear-gradient(${direction}, ${stops});backdrop-filter:blur(${pocket.blur}px);-webkit-backdrop-filter:blur(${pocket.blur}px);-webkit-mask-image:linear-gradient(${direction}, #000 ${(pocket.blurSolidUntil * 100).toFixed(1)}%, transparent)"></div>`
}

function rgba(color: Rgba, alpha: number) {
  return toCss({ ...color, a: alpha })
}

function glyphColor(style: PanelPlan['statusBar']) {
  return style === 'light-content' ? '#ffffff' : '#000000'
}

function statusBar(width: number, style: PanelPlan['statusBar'], chrome: Chrome26) {
  const { statusBar: s } = chrome
  const color = glyphColor(style)
  const right = width - s.trailingInset
  return `<div style="position:absolute;left:0;top:0;width:${width}px;height:${s.height}px;color:${color}">
    <div style="position:absolute;left:${s.timeCenterX - 40}px;width:80px;top:${s.timeBaseline - s.timeFontSize}px;height:${s.timeFontSize}px;line-height:${s.timeFontSize}px;text-align:center;font-size:${s.timeFontSize}px;font-weight:600;letter-spacing:-0.2px">9:41</div>
    <svg style="position:absolute;left:${right - 79}px;top:${s.iconsCenterY - 6.5}px" width="79" height="13" viewBox="0 0 79 13" fill="${color}">
      <rect x="0" y="8.3" width="3.2" height="4.4" rx="0.9"/><rect x="5" y="5.9" width="3.2" height="6.8" rx="0.9"/>
      <rect x="10" y="3.4" width="3.2" height="9.3" rx="0.9"/><rect x="15" y="0.8" width="3.2" height="11.9" rx="0.9"/>
      <path d="M31.5 2.6c2.4 0 4.6.9 6.3 2.5l1.2-1.2C37 1.9 34.4.8 31.5.8s-5.5 1.1-7.5 3.1l1.2 1.2c1.7-1.6 3.9-2.5 6.3-2.5zm0 3.6c1.4 0 2.7.5 3.7 1.5l1.2-1.2c-1.4-1.3-3.1-2.1-4.9-2.1s-3.5.8-4.9 2.1l1.2 1.2c1-1 2.3-1.5 3.7-1.5zm0 3.5c-.6 0-1.1.2-1.5.6l1.5 1.5 1.5-1.5c-.4-.4-.9-.6-1.5-.6z"/>
      <rect x="51.3" y="0.8" width="24.4" height="11.5" rx="3.6" fill="none" stroke="${color}" stroke-opacity="0.4" stroke-width="1"/>
      <rect x="53.2" y="2.7" width="20.6" height="7.7" rx="2.1"/>
      <path d="M76.9 4.6v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" fill-opacity="0.4"/>
    </svg>
  </div>`
}

function expandedToolbar(screen: { width: number, height: number }, hostLabel: string, chrome: Chrome26) {
  const t = chrome.toolbarExpanded
  const centerY = screen.height - t.bottomMargin - t.height / 2
  const top = centerY - t.height / 2
  const pillLeft = t.sideMargin + t.height + t.gap
  const pillWidth = screen.width - 2 * pillLeft
  const iconColor = '#000000'
  return `<div>
    <div class="glass" style="left:${t.sideMargin}px;top:${top}px;width:${t.height}px;height:${t.height}px;border-radius:50%">
      <svg width="12" height="20" viewBox="0 0 12 20"><path d="M10 2 2 10l8 8" fill="none" stroke="${t.disabledIconColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div class="glass" style="left:${pillLeft}px;top:${top}px;width:${pillWidth}px;height:${t.height}px;border-radius:${t.height / 2}px">
      <svg style="position:absolute;left:${t.pageMenuIconLeft}px;top:${t.height / 2 - 9}px" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="${iconColor}" stroke-width="1.6" stroke-linecap="round">
        <rect x="2" y="1.5" width="14" height="8.5" rx="2"/><path d="M2 13.2h14M2 16.4h9"/>
      </svg>
      <span style="font-size:${t.fontSize}px;font-weight:500;color:${iconColor};letter-spacing:-0.3px;white-space:nowrap;max-width:${pillWidth - 90}px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(hostLabel)}</span>
      <svg style="position:absolute;right:${t.reloadIconRight}px;top:${t.height / 2 - 10}px" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="${iconColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15.6 7.2A6.6 6.6 0 1 0 16.6 11"/><path d="M16.2 2.6v4.8h-4.8"/>
      </svg>
    </div>
    <div class="glass" style="left:${screen.width - t.sideMargin - t.height}px;top:${top}px;width:${t.height}px;height:${t.height}px;border-radius:50%">
      <svg width="22" height="6" viewBox="0 0 22 6" fill="${iconColor}"><circle cx="3" cy="3" r="2.4"/><circle cx="11" cy="3" r="2.4"/><circle cx="19" cy="3" r="2.4"/></svg>
    </div>
  </div>`
}

function collapsedToolbar(screen: { width: number, height: number }, hostLabel: string, chrome: Chrome26) {
  const t = chrome.toolbarCollapsed
  const top = screen.height - t.bottomMargin - t.height
  return `<div class="glass" style="left:50%;transform:translateX(-50%);top:${top}px;height:${t.height}px;padding:0 ${t.paddingX}px;border-radius:${t.height / 2}px">
    <span style="font-size:${t.fontSize}px;font-weight:500;color:#000;letter-spacing:-0.2px;white-space:nowrap">${escapeHtml(hostLabel)}</span>
  </div>`
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
