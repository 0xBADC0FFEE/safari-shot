import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { webkit, type Browser } from 'playwright'
import type { AddressInfo } from 'node:net'
import { startCalibrationServer, referenceReportId, REPORTS_DIR } from './server.ts'
import { contactSheet } from './contact-sheet.ts'
import { takeShot, type ShotReport } from '../src/shot.ts'
import { findDevice } from '../src/devices.ts'
import { deltaE76, parseSimpleColor, relativeLuminance, toHex, type Rgba } from '../src/color.ts'
import { IOS_VERSIONS, type IosVersion, type Scenario, type ScrollState } from '../src/scenario.ts'

const REFERENCES_DIR = join(import.meta.dirname, 'references')
const OUTPUT_DIR = join(import.meta.dirname, 'out', 'compare')
export const EXPECTATIONS_DIR = join(import.meta.dirname, 'expectations')
const SETTLE_MS = 500
const DEFAULT_OVERSCROLL_PT = 150
const GLYPH_CONTRAST = 0.3
const GLYPH_BACKGROUND_GAP = 3
const TIME_BOX: Region = { name: 'time', x: 45, y: 24, width: 60, height: 18, tolerance: 0 }

/** A region in points whose mean color must match the reference within `tolerance` ΔE76. */
interface Region {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly tolerance: number
}

type StatusBarStyle = 'dark-content' | 'light-content'

/** What one Simulator reference shows in the panel regions, plus how to replay it. */
export interface Expectation {
  readonly ios: IosVersion
  readonly name: string
  readonly stem: string
  readonly scrollY: number
  readonly toolbar: 'expanded' | 'collapsed'
  readonly regions: readonly (Region & { readonly color: string })[]
  readonly statusBar: StatusBarStyle
}

export interface RegionResult {
  readonly region: string
  readonly reference: string
  readonly ours: string
  readonly deltaE: number
  readonly pass: boolean
}

export interface CaseResult {
  readonly name: string
  readonly stem: string
  readonly regions: readonly RegionResult[]
  readonly statusBar: { readonly reference: StatusBarStyle, readonly ours: StatusBarStyle, readonly pass: boolean }
  readonly pass: boolean
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      ios: { type: 'string', default: '26' },
      cases: { type: 'string' },
      states: { type: 'string' },
      sheets: { type: 'boolean', default: false },
    },
  })
  const ios = IOS_VERSIONS.find(v => v === values.ios)
  if (!ios) throw new Error(`--ios must be one of ${IOS_VERSIONS.join(', ')}`)
  const renderer = await startRenderer()
  try {
    const filter = { cases: values.cases?.split(','), states: values.states?.split(',') as ScrollState[] | undefined }
    const expectations = await buildExpectations(renderer, ios, filter)
    if (!filter.cases && !filter.states) {
      await mkdir(EXPECTATIONS_DIR, { recursive: true })
      await writeFile(join(EXPECTATIONS_DIR, `ios${values.ios}.json`), JSON.stringify(expectations, null, 1))
    }
    const results = await checkExpectations(renderer, expectations, { sheets: values.sheets })
    printTable(results)
    await mkdir(OUTPUT_DIR, { recursive: true })
    await writeFile(join(OUTPUT_DIR, 'summary.json'), JSON.stringify(results, null, 2))
    if (results.some(r => !r.pass)) process.exitCode = 1
  } finally {
    await renderer.close()
  }
}

/** A browser plus a corpus server on a free port, so comparisons can run while a capture holds the default port. */
export interface Renderer {
  readonly browser: Browser
  readonly origin: string
  close(): Promise<void>
}

/**
 * Launches WebKit and a calibration server on an ephemeral port.
 * @returns the renderer; call `close` when done
 */
export async function startRenderer(): Promise<Renderer> {
  const server = await startCalibrationServer(0)
  const browser = await webkit.launch()
  return {
    browser,
    origin: `http://localhost:${(server.address() as AddressInfo).port}`,
    async close() {
      await browser.close()
      server.close()
    },
  }
}

/**
 * Reads Simulator references and records the panel colors they show.
 * @param renderer browser and corpus server used to render each scenario once, to learn its fills
 * @param ios iOS major version of the references
 * @param filter optional case and state restriction
 * @returns one expectation per reference image
 */
export async function buildExpectations(renderer: Renderer, ios: IosVersion, filter: { cases?: string[], states?: ScrollState[] } = {}): Promise<Expectation[]> {
  const root = join(REFERENCES_DIR, `ios${ios}`)
  const expectations: Expectation[] = []
  for (const name of (await readdir(root)).sort()) {
    if (filter.cases && !filter.cases.includes(name)) continue
    for (const file of (await readdir(join(root, name))).filter(f => f.endsWith('.png')).sort()) {
      const stem = basename(file, '.png')
      if (filter.states && !filter.states.includes(parseStem(stem).scenario.state)) continue
      const replay = await readReplay(ios, name, stem)
      const { report } = await render(renderer, ios, name, stem, replay)
      const reference = await rawImage(await readFile(join(root, name, file)))
      const scale = report.device.scale
      expectations.push({
        ios, name, stem, ...replay,
        regions: regionsFor(report).map(region => ({ ...region, color: toHex(meanColor(reference, region, scale)) })),
        statusBar: glyphStyle(reference, TIME_BOX, scale),
      })
    }
  }
  return expectations
}

/**
 * Renders every expectation with safari-shot and compares the panel regions.
 * @param renderer browser and corpus server
 * @param expectations recorded reference colors
 * @param options `sheets`: also write review PNGs with the reference next to ours
 * @returns one result per expectation
 */
export async function checkExpectations(renderer: Renderer, expectations: readonly Expectation[], options: { sheets?: boolean } = {}): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  for (const expectation of expectations) {
    const { png } = await render(renderer, expectation.ios, expectation.name, expectation.stem, expectation)
    const scale = findDevice(parseStem(expectation.stem).deviceId).scale
    const ours = await rawImage(png)
    const regions = expectation.regions.map(region => {
      const reference = parseSimpleColor(region.color)!
      const our = meanColor(ours, region, scale)
      const deltaE = deltaE76(reference, our)
      return { region: region.name, reference: region.color, ours: toHex(our), deltaE: Math.round(deltaE * 10) / 10, pass: deltaE <= region.tolerance }
    })
    const ourStyle = glyphStyle(ours, TIME_BOX, scale)
    const statusBar = { reference: expectation.statusBar, ours: ourStyle, pass: ourStyle === expectation.statusBar }
    results.push({ name: expectation.name, stem: expectation.stem, regions, statusBar, pass: statusBar.pass && regions.every(r => r.pass) })
    if (options.sheets) {
      const outDir = join(OUTPUT_DIR, `ios${expectation.ios}`, expectation.name)
      await mkdir(outDir, { recursive: true })
      const oursPath = join(outDir, `${expectation.stem}.ours.png`)
      await writeFile(oursPath, png)
      await contactSheet(join(outDir, `${expectation.stem}.sheet.png`), 402, [join(REFERENCES_DIR, `ios${expectation.ios}`, expectation.name, `${expectation.stem}.png`), oursPath])
    }
  }
  return results
}

function parseStem(stem: string) {
  const [deviceId, orientation, theme, state] = stem.split('.') as [string, Scenario['orientation'], Scenario['theme'], ScrollState]
  return { deviceId, scenario: { state, theme, orientation, mode: 'browser' } satisfies Scenario }
}

async function render({ browser, origin }: Renderer, ios: IosVersion, name: string, stem: string, replay: { scrollY: number, toolbar: 'expanded' | 'collapsed' }): Promise<{ png: Buffer, report: ShotReport }> {
  const { deviceId, scenario } = parseStem(stem)
  return takeShot(browser, {
    url: `${origin}/case/${name}`,
    device: findDevice(deviceId), ios, scenario, settleMs: SETTLE_MS, overscroll: DEFAULT_OVERSCROLL_PT,
    scrollY: replay.scrollY, toolbar: replay.toolbar,
  })
}

async function readReplay(ios: IosVersion, name: string, stem: string): Promise<{ scrollY: number, toolbar: 'expanded' | 'collapsed' }> {
  const toolbarByState = parseStem(stem).scenario.state === 'scrolled' ? 'collapsed' as const : 'expanded' as const
  try {
    const states = JSON.parse(await readFile(join(REPORTS_DIR, `${referenceReportId(ios, name, stem)}.json`), 'utf8')) as { inner: [number, number], scrollY: number }[]
    const last = states.at(-1)!
    return { scrollY: last.scrollY, toolbar: last.inner[1] > states[0]!.inner[1] ? 'collapsed' : 'expanded' }
  } catch {
    return { scrollY: 0, toolbar: toolbarByState }
  }
}

function regionsFor(report: ShotReport): Region[] {
  const { height } = report.device.screen
  const top = report.layout.obscuredInsets.top!
  const bottom = report.layout.obscuredInsets.bottom!
  const statusGap = { name: 'status-band', x: 120, y: 2, width: 150, height: top - 4, tolerance: 3 }
  if (report.safari === '18') return regions18(report, top, height - bottom)
  // The rubber-band distance of a simulator gesture is not reproducible; only an extension makes the band comparable.
  if (report.scenario.state === 'overscroll-bottom') return report.panels.top?.fill === 'extension' ? [statusGap] : []
  if (report.scenario.state === 'overscroll-top') return [statusGap]
  if (report.layout.toolbar === 'expanded') {
    return [
      statusGap,
      { name: 'bottom-left-edge', x: 0, y: height - bottom, width: 30, height: bottom, tolerance: 4 },
      { name: 'below-toolbar', x: 90, y: height - 30, width: 220, height: 28, tolerance: 4 },
      { name: 'glass-pill', x: 135, y: 797, width: 25, height: 8, tolerance: 6 },
      { name: 'glass-back', x: 50, y: 806, width: 6, height: 20, tolerance: 6 },
    ]
  }
  return [
    statusGap,
    { name: 'bottom-left-edge', x: 0, y: height - bottom, width: 140, height: bottom, tolerance: 4 },
    { name: 'glass-collapsed', x: 161, y: 834, width: 8, height: 18, tolerance: 6 },
  ]
}

// Clear of the clock, the Dynamic Island, the URL field's icons and text, the button row, and the home indicator.
function regions18(report: ShotReport, top: number, toolbarTop: number): Region[] {
  const statusBand = { name: 'status-band', x: 112, y: 2, width: 24, height: top - 4, tolerance: 3 }
  // The rubber-band distance of a simulator gesture is not reproducible, and the toolbar material shows what it uncovers.
  if (report.scenario.state.startsWith('overscroll')) return [statusBand]
  if (report.layout.toolbar === 'collapsed') return [statusBand, { name: 'collapsed-bar', x: 10, y: toolbarTop + 4, width: 100, height: 44, tolerance: 4 }]
  return [
    statusBand,
    { name: 'url-field', x: 80, y: toolbarTop + 12, width: 50, height: 8, tolerance: 4 },
    // The material fit has RMSE 4.2 over solid colors.
    { name: 'material', x: 50, y: toolbarTop + 96, width: 50, height: 14, tolerance: 9 },
  ]
}

interface RawImage { readonly data: Buffer, readonly width: number, readonly channels: number }

async function rawImage(png: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, channels: info.channels }
}

function pixels(image: RawImage, region: Region, scale: number) {
  const out: Rgba[] = []
  for (let y = Math.round(region.y * scale); y < Math.round((region.y + region.height) * scale); y++) {
    for (let x = Math.round(region.x * scale); x < Math.round((region.x + region.width) * scale); x++) {
      const i = (y * image.width + x) * image.channels
      out.push({ r: image.data[i]!, g: image.data[i + 1]!, b: image.data[i + 2]!, a: 1 })
    }
  }
  return out
}

function meanColor(image: RawImage, region: Region, scale: number): Rgba {
  const all = pixels(image, region, scale)
  const sum = all.reduce((acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }), { r: 0, g: 0, b: 0 })
  return { r: Math.round(sum.r / all.length), g: Math.round(sum.g / all.length), b: Math.round(sum.b / all.length), a: 1 }
}

function glyphStyle(image: RawImage, region: Region, scale: number): StatusBarStyle {
  // Content under the status bar varies across columns (stripes, text), so each column is compared
  // with its own background just above and below the glyph box.
  const luminanceAt = (x: number, y: number) => {
    const i = (Math.round(y * scale) * image.width + Math.round(x * scale)) * image.channels
    return relativeLuminance({ r: image.data[i]!, g: image.data[i + 1]!, b: image.data[i + 2]!, a: 1 })
  }
  let darker = 0
  let lighter = 0
  for (let x = region.x; x < region.x + region.width; x += 1 / scale) {
    const background = (luminanceAt(x, region.y - GLYPH_BACKGROUND_GAP) + luminanceAt(x, region.y + region.height + GLYPH_BACKGROUND_GAP)) / 2
    for (let y = region.y; y < region.y + region.height; y += 1 / scale) {
      const delta = luminanceAt(x, y) - background
      if (delta < -GLYPH_CONTRAST) darker++
      if (delta > GLYPH_CONTRAST) lighter++
    }
  }
  return darker >= lighter ? 'dark-content' : 'light-content'
}

/**
 * Prints one line per case and a pass count.
 * @param results comparison results
 */
export function printTable(results: readonly CaseResult[]) {
  for (const r of results) {
    const failed = r.regions.filter(x => !x.pass).map(x => `${x.region} ${x.reference}→${x.ours} ΔE${x.deltaE}`)
    if (!r.statusBar.pass) failed.push(`status-bar ${r.statusBar.reference}→${r.statusBar.ours}`)
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.stem}${failed.length ? `  ${failed.join('; ')}` : ''}`)
  }
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed`)
}
