import type { Browser } from 'playwright'
import { capturePage, type PageCapture } from './capture.ts'
import { planPanels, planPanels18, type PanelPlan, type Safari18Plan, type Safari26Plan } from './model.ts'
import { composeScreenshot } from './compose.ts'
import { toHex, type Rgba } from './color.ts'
import type { FixedEdge, FixedEdges } from './edges.ts'
import type { DevicePreset } from './devices.ts'
import type { IosVersion, Scenario } from './scenario.ts'

export interface ShotRequest {
  readonly url: string
  readonly device: DevicePreset
  readonly ios: IosVersion
  readonly scenario: Scenario
  readonly scrollY: number
  readonly overscroll: number
  readonly settleMs: number
  readonly toolbar?: 'expanded' | 'collapsed'
}

export interface Shot {
  readonly png: Buffer
  readonly report: ShotReport
}

/** Machine-readable explanation of one screenshot; written next to the PNG. */
export interface ShotReport {
  readonly url: string
  readonly device: { readonly id: string, readonly name: string, readonly scale: number, readonly screen: { readonly width: number, readonly height: number } }
  readonly scenario: Scenario
  readonly safari: IosVersion
  readonly layout: {
    readonly toolbar: 'expanded' | 'collapsed'
    readonly obscuredInsets: Readonly<Record<string, number>>
    readonly layoutViewport: { readonly top: number, readonly width: number, readonly height: number }
    readonly scrollY: number
  }
  readonly panels: {
    readonly top: PanelReport | null
    readonly bottom: PanelReport | null
    readonly statusBar: PanelPlan['statusBar']
    /** Liquid Glass variant; null before iOS 26. */
    readonly glass: Safari26Plan['glass'] | null
    readonly overscrollColor: string
  }
  readonly underPageBackground: string
  readonly themeColor: { readonly color: string | null, readonly source: string, readonly usedByPanels: boolean }
  readonly fixedEdges: { readonly atLoad: EdgesReport, readonly final: EdgesReport }
  readonly page: {
    readonly title: string
    readonly viewportMeta: string | null
    readonly viewportFitCover: boolean
    readonly colorScheme: PageCapture['facts']['colorScheme']
    readonly appleWebApp: PageCapture['facts']['appleWebApp']
    readonly manifest: PageCapture['manifest']
  }
}

interface PanelReport {
  /** iOS 26: a color `extension` or `content` under glass. iOS 18: a solid `tint`, the toolbar `material`, or the collapsed `bar`. */
  readonly fill: 'extension' | 'content' | 'tint' | 'material' | 'bar'
  readonly color: string
  readonly reason: string
}

type EdgesReport = Readonly<Record<string, { readonly kind: FixedEdge['kind'], readonly color?: string, readonly container?: string, readonly reason: string }>>

/**
 * Produces one screenshot and its report.
 * @param browser Playwright browser
 * @param request page, device, scenario and scroll parameters
 * @returns the PNG and the report
 */
export async function takeShot(browser: Browser, request: ShotRequest): Promise<Shot> {
  const capture = await capturePage(browser, request)
  const plan = request.ios === '26' ? planPanels(capture, request.scenario) : planPanels18(capture, request.scenario)
  const png = await composeScreenshot(browser, { capture, plan, device: request.device, hostLabel: hostLabel(capture.facts.url) })
  return { png, report: buildReport(request, capture, plan) }
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

function buildReport(request: ShotRequest, capture: PageCapture, plan: PanelPlan): ShotReport {
  const { device, scenario } = request
  const { layout, facts } = capture
  return {
    url: facts.url,
    device: { id: device.id, name: device.name, scale: device.scale, screen: layout.screen },
    scenario,
    safari: plan.safari,
    layout: {
      toolbar: layout.toolbar,
      obscuredInsets: layout.obscured,
      layoutViewport: { top: layout.viewportTop, width: facts.viewport.width, height: facts.viewport.height },
      scrollY: layout.scrollY,
    },
    panels: plan.safari === '26' ? panels26(plan) : panels18(plan),
    underPageBackground: toHex(plan.underPageBackground),
    themeColor: { color: plan.themeColor.color ? toHex(plan.themeColor.color) : null, source: plan.themeColor.source, usedByPanels: plan.themeColor.usedByPanels },
    fixedEdges: { atLoad: edgesReport(capture.edgesAtLoad), final: edgesReport(capture.edges) },
    page: {
      title: facts.title,
      viewportMeta: facts.viewportMeta,
      viewportFitCover: /viewport-fit\s*=\s*cover/i.test(facts.viewportMeta ?? ''),
      colorScheme: facts.colorScheme,
      appleWebApp: facts.appleWebApp,
      manifest: capture.manifest,
    },
  }
}

function panels26(plan: Safari26Plan): ShotReport['panels'] {
  const panel = (fill: Safari26Plan['fills']['top']): PanelReport | null => !fill ? null : {
    fill: fill.kind,
    color: toHex(fill.kind === 'extension' ? fill.color : fill.pocket.color),
    reason: fill.reason,
  }
  const overscrollColor: Rgba = plan.topExtensionGrowth > 0 && plan.fills.top?.kind === 'extension' ? plan.fills.top.color : plan.underPageBackground
  return { top: panel(plan.fills.top), bottom: panel(plan.fills.bottom), statusBar: plan.statusBar, glass: plan.glass, overscrollColor: toHex(overscrollColor) }
}

function panels18(plan: Safari18Plan): ShotReport['panels'] {
  const bottom: PanelReport = plan.toolbar === 'expanded'
    ? { fill: 'material', color: toHex(plan.toolbarColor), reason: `${plan.material} toolbar material over the content under it` }
    : { fill: 'bar', color: toHex(plan.toolbarColor), reason: `collapsed bar in the bottom scroll-edge color ${toHex(plan.bottomBar)} over content` }
  return {
    top: { fill: 'tint', color: toHex(plan.tint.color), reason: `${plan.tint.source}: ${plan.tint.reason}` },
    bottom,
    statusBar: plan.statusBar,
    glass: null,
    overscrollColor: toHex(plan.underPageBackground),
  }
}

function edgesReport(edges: FixedEdges): EdgesReport {
  return Object.fromEntries(Object.entries(edges).map(([side, edge]) => [side, {
    kind: edge.kind,
    ...(edge.kind === 'color' ? { color: toHex(edge.color) } : {}),
    ...('container' in edge ? { container: edge.container } : {}),
    reason: edge.reason,
  }]))
}
