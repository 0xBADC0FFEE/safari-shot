import { execFile } from 'node:child_process'
import { promisify, parseArgs } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import sharp from 'sharp'
import { openSimulatorSession, type SimulatorSession } from './simulator.ts'
import { startCalibrationServer } from './server.ts'

// Measures Safari geometry per device type with the `geometry` corpus page:
// a blue page (glass pills read as light runs) with a narrow fixed red marker at top: 0.

const run = promisify(execFile)
const OUT_DIR = join(import.meta.dirname, 'out', 'devices')
const REPORTS_DIR = join(import.meta.dirname, 'out', 'reports')
const LOAD_SETTLE_MS = 4000
// Its own port, so a measurement can run while references are being captured.
const MEASURE_PORT = 8766
const SCROLL_SETTLE_MS = 1500
const GLASS_LUMINANCE_LIFT = 40
// Every current iPhone renders at 3x except the SE.
const scaleOf = (type: string) => type.includes('SE') ? 2 : 3

const { values } = parseArgs({
  options: {
    runtime: { type: 'string', default: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5' },
    types: { type: 'string', default: 'iPhone 17 Pro' },
    orientations: { type: 'string', default: 'portrait' },
  },
})

interface Run { readonly start: number, readonly end: number }

export interface DeviceMeasurement {
  readonly type: string
  readonly orientation: string
  readonly screen: { readonly width: number, readonly height: number, readonly scale: number }
  readonly topInset: number
  readonly innerExpanded: [number, number]
  readonly innerCollapsed: [number, number]
  readonly expandedRow: readonly Run[]
  readonly expandedColumn: readonly Run[]
  readonly collapsedRow: readonly Run[]
  readonly collapsedColumn: readonly Run[]
}

if (import.meta.main) {
  const server = await startCalibrationServer(MEASURE_PORT)
  await mkdir(OUT_DIR, { recursive: true })
  const results: DeviceMeasurement[] = []
  try {
    for (const type of values.types.split(',')) {
      const udid = await ensureSimulator(type, values.runtime)
      const session = await openSimulatorSession(udid)
      try {
        await dismissFirstRunTips(session)
        for (const orientation of values.orientations.split(',') as ('portrait' | 'landscape')[]) {
          await session.perform([{ action: 'orient', label: orientation }])
          await sleep(1000)
          results.push(await measure(session, type, orientation))
          console.log(JSON.stringify(results.at(-1)))
        }
        await session.perform([{ action: 'orient', label: 'portrait' }])
      } finally {
        await session.close()
        await run('xcrun', ['simctl', 'shutdown', udid]).catch(() => {})
      }
    }
  } finally {
    server.close()
  }
  const runtimeTag = values.runtime.split('.').at(-1)
  await writeFile(join(OUT_DIR, `measurements-${runtimeTag}.json`), JSON.stringify(results, null, 2))
}

async function ensureSimulator(type: string, runtime: string) {
  const name = `safari-shot ${type}`
  const { stdout } = await run('xcrun', ['simctl', 'list', 'devices', '-j'])
  const devices = JSON.parse(stdout).devices as Record<string, { name: string, udid: string }[]>
  const existing = devices[runtime]?.find(d => d.name === name)
  if (existing) return existing.udid
  const { stdout: udid } = await run('xcrun', ['simctl', 'create', name, type, runtime])
  return udid.trim()
}

// A fresh simulator shows a Safari tip over the toolbar on first load; scrolling once makes it go away.
async function dismissFirstRunTips(session: SimulatorSession) {
  await session.open(`http://localhost:${MEASURE_PORT}/case/geometry`)
  await sleep(LOAD_SETTLE_MS)
  await session.perform([{ action: 'swipe', label: 'up', velocity: 400 }, { action: 'swipe', label: 'down', velocity: 400 }])
  await sleep(SCROLL_SETTLE_MS)
}

async function measure(session: SimulatorSession, type: string, orientation: string): Promise<DeviceMeasurement> {
  const slug = `${type.replace(/\W+/g, '-')}.${orientation}`
  const reportId = `geometry.${slug}`
  await session.open(`http://localhost:${MEASURE_PORT}/case/geometry?report=${reportId}&t=${Date.now()}`)
  await sleep(LOAD_SETTLE_MS)
  const expandedPath = join(OUT_DIR, `${slug}.expanded.png`)
  await session.screenshot(expandedPath)
  await session.perform([{ action: 'swipe', label: 'up', velocity: 400 }])
  await sleep(SCROLL_SETTLE_MS)
  const collapsedPath = join(OUT_DIR, `${slug}.collapsed.png`)
  await session.screenshot(collapsedPath)

  const states = JSON.parse(await readFile(join(REPORTS_DIR, `${reportId}.json`), 'utf8')) as { inner: [number, number] }[]
  const expanded = await analyze(expandedPath, scaleOf(type))
  const collapsed = await analyze(collapsedPath, scaleOf(type))
  return {
    type, orientation,
    screen: expanded.screen,
    topInset: expanded.markerTop,
    innerExpanded: states[0]!.inner,
    innerCollapsed: states.at(-1)!.inner,
    expandedRow: expanded.row, expandedColumn: expanded.column,
    collapsedRow: collapsed.row, collapsedColumn: collapsed.column,
  }
}

async function analyze(path: string, scale: number) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels
    return [data[i]!, data[i + 1]!, data[i + 2]!] as const
  }
  const isRed = ([r, g, b]: readonly number[]) => r! > 200 && g! < 60 && b! < 60
  let markerTop = -1
  for (let y = 0; y < info.height && markerTop < 0; y++) if (isRed(at(Math.round(10 * scale), y))) markerTop = y / scale
  const background = at(Math.round(2 * scale), Math.round(info.height * 0.5))
  const lift = (p: readonly number[]) => (p[0]! + p[1]! + p[2]!) / 3 - (background[0] + background[1] + background[2]) / 3
  const runs = (length: number, sample: (t: number) => readonly number[]): Run[] => {
    const out: Run[] = []
    let start = -1
    for (let t = 0; t <= length; t++) {
      const glass = t < length && lift(sample(t)) > GLASS_LUMINANCE_LIFT
      if (glass && start < 0) start = t
      if (!glass && start >= 0) {
        if (t - start > 2 * scale) out.push({ start: start / scale, end: t / scale })
        start = -1
      }
    }
    return out
  }
  const bottomStart = Math.round(info.height * 0.8)
  const columnX = Math.round(info.width * 0.3)
  const column = runs(info.height - bottomStart, t => at(columnX, bottomStart + t)).map(r => ({ start: r.start + bottomStart / scale, end: r.end + bottomStart / scale }))
  const lowest = column.at(-1)
  const rowY = lowest ? Math.round((lowest.start + lowest.end) / 2 * scale) : info.height - 1
  const row = runs(info.width, t => at(t, rowY))
  return { screen: { width: info.width / scale, height: info.height / scale, scale }, markerTop, column, row }
}
