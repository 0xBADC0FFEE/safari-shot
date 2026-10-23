import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { webkit, type Browser } from 'playwright'
import { startCalibrationServer, CALIBRATION_PORT } from './server.ts'
import { contactSheet } from './contact-sheet.ts'
import { takeShot, type ShotReport } from '../src/shot.ts'
import { findDevice, type DevicePreset } from '../src/devices.ts'
import { deltaE76, relativeLuminance, toHex, type Rgba } from '../src/color.ts'
import type { Scenario, ScrollState } from '../src/scenario.ts'

const REFERENCES_DIR = join(import.meta.dirname, 'references')
const REPORTS_DIR = join(import.meta.dirname, 'out', 'reports')
const OUTPUT_DIR = join(import.meta.dirname, 'out', 'compare')
const SETTLE_MS = 500
const DEFAULT_OVERSCROLL_PT = 150

/** A region in points whose mean color must match the reference within `tolerance` ΔE76. */
interface Region {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly tolerance: number
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
  readonly statusBar: { readonly reference: string, readonly ours: string, readonly pass: boolean }
  readonly pass: boolean
}

const { values } = parseArgs({
  options: {
    ios: { type: 'string', default: '26' },
    cases: { type: 'string' },
    states: { type: 'string' },
    sheets: { type: 'boolean', default: false },
  },
})

if (import.meta.main) {
  const server = await startCalibrationServer()
  const browser = await webkit.launch()
  try {
    const results = await compareAll(browser, values.ios, values.cases?.split(','), values.states?.split(',') as ScrollState[] | undefined, values.sheets)
    printTable(results)
    await writeFile(join(OUTPUT_DIR, 'summary.json'), JSON.stringify(results, null, 2))
    if (results.some(r => !r.pass)) process.exitCode = 1
  } finally {
    await browser.close()
    server?.close()
  }
}

/**
 * Re-renders every reference scenario with safari-shot and compares panel regions.
 * @param browser Playwright browser
 * @param ios iOS major version of the references
 * @param onlyCases restrict to these corpus cases
 * @param onlyStates restrict to these scroll states
 * @param sheets write side-by-side PNGs for review
 * @returns one result per reference image
 */
export async function compareAll(browser: Browser, ios: string, onlyCases?: string[], onlyStates?: ScrollState[], sheets = false): Promise<CaseResult[]> {
  const root = join(REFERENCES_DIR, `ios${ios}`)
  const results: CaseResult[] = []
  for (const name of (await readdir(root)).sort()) {
    if (onlyCases && !onlyCases.includes(name)) continue
    for (const file of (await readdir(join(root, name))).filter(f => f.endsWith('.png')).sort()) {
      const stem = basename(file, '.png')
      const [deviceId, orientation, theme, state] = stem.split('.') as [string, Scenario['orientation'], Scenario['theme'], ScrollState]
      if (onlyStates && !onlyStates.includes(state)) continue
      const device = findDevice(deviceId)
      const scenario: Scenario = { state, theme, orientation, mode: 'browser' }
      const replay = await readReplay(name, stem)
      const { png, report } = await takeShot(browser, {
        url: `http://localhost:${CALIBRATION_PORT}/case/${name}`,
        device, scenario, settleMs: SETTLE_MS, overscroll: DEFAULT_OVERSCROLL_PT,
        scrollY: replay?.scrollY ?? 0,
        toolbar: replay?.toolbar,
      })
      const referencePath = join(root, name, file)
      const outDir = join(OUTPUT_DIR, name)
      await mkdir(outDir, { recursive: true })
      const oursPath = join(outDir, `${stem}.ours.png`)
      await writeFile(oursPath, png)
      await writeFile(join(outDir, `${stem}.ours.json`), JSON.stringify(report, null, 2))
      if (sheets) await contactSheet(join(outDir, `${stem}.sheet.png`), 402, [referencePath, oursPath])
      results.push(await compareImages(name, stem, referencePath, png, device, report))
    }
  }
  return results
}

async function readReplay(name: string, stem: string): Promise<{ scrollY: number, toolbar: 'expanded' | 'collapsed' } | undefined> {
  try {
    const states = JSON.parse(await readFile(join(REPORTS_DIR, `${name}.${stem}.json`), 'utf8')) as { inner: [number, number], scrollY: number }[]
    const last = states.at(-1)!
    const first = states[0]!
    return { scrollY: last.scrollY, toolbar: last.inner[1] > first.inner[1] ? 'collapsed' : 'expanded' }
  } catch {
    return undefined
  }
}

function regionsFor(report: ShotReport): Region[] {
  const { height } = report.device.screen
  const insets = report.layout.obscuredInsets
  const top = insets.top!
  const bottom = insets.bottom!
  const statusGap = { name: 'status-band', x: 120, y: 2, width: 150, height: top - 4, tolerance: 3 }
  if (report.scenario.state.startsWith('overscroll')) return [statusGap]
  const regions: Region[] = [statusGap]
  if (report.layout.toolbar === 'expanded') {
    regions.push(
      { name: 'bottom-left-edge', x: 0, y: height - bottom, width: 30, height: bottom, tolerance: 4 },
      { name: 'below-toolbar', x: 90, y: height - 30, width: 220, height: 28, tolerance: 4 },
      { name: 'glass-pill', x: 135, y: 797, width: 25, height: 8, tolerance: 6 },
      { name: 'glass-back', x: 50, y: 806, width: 6, height: 20, tolerance: 6 },
    )
  } else {
    regions.push(
      { name: 'bottom-left-edge', x: 0, y: height - bottom, width: 140, height: bottom, tolerance: 4 },
      { name: 'glass-collapsed', x: 161, y: 834, width: 8, height: 18, tolerance: 6 },
    )
  }
  return regions
}

async function compareImages(name: string, stem: string, referencePath: string, ours: Buffer, device: DevicePreset, report: ShotReport): Promise<CaseResult> {
  const reference = await rawImage(await readFile(referencePath))
  const mine = await rawImage(ours)
  const regions = regionsFor(report).map(region => {
    const ref = meanColor(reference, region, device.scale)
    const our = meanColor(mine, region, device.scale)
    const deltaE = deltaE76(ref, our)
    return { region: region.name, reference: toHex(ref), ours: toHex(our), deltaE: Math.round(deltaE * 10) / 10, pass: deltaE <= region.tolerance }
  })
  const timeBox = { name: 'time', x: 45, y: 24, width: 60, height: 18, tolerance: 0 }
  const refStyle = glyphStyle(reference, timeBox, device.scale)
  const ourStyle = glyphStyle(mine, timeBox, device.scale)
  const statusBar = { reference: refStyle, ours: ourStyle, pass: refStyle === ourStyle }
  return { name, stem, regions, statusBar, pass: statusBar.pass && regions.every(r => r.pass) }
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

function glyphStyle(image: RawImage, region: Region, scale: number): 'dark-content' | 'light-content' {
  const luminances = pixels(image, region, scale).map(relativeLuminance).sort((a, b) => a - b)
  const background = luminances[Math.floor(luminances.length / 2)]!
  const darkest = luminances[0]!
  const brightest = luminances.at(-1)!
  return background - darkest >= brightest - background ? 'dark-content' : 'light-content'
}

function printTable(results: CaseResult[]) {
  for (const r of results) {
    const failed = r.regions.filter(x => !x.pass).map(x => `${x.region} ${x.reference}→${x.ours} ΔE${x.deltaE}`)
    if (!r.statusBar.pass) failed.push(`status-bar ${r.statusBar.reference}→${r.statusBar.ours}`)
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.stem}${failed.length ? `  ${failed.join('; ')}` : ''}`)
  }
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed`)
}
