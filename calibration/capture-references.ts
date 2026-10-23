import { mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { corpus } from './corpus.ts'
import { startCalibrationServer, referenceReportId, CALIBRATION_PORT } from './server.ts'
import { openSimulatorSession, type SimulatorSession } from './simulator.ts'
import { SCROLL_STATES, THEMES, ORIENTATIONS, scenarioStem, type Scenario, type ScrollState } from '../src/scenario.ts'

const run = promisify(execFile)

const REFERENCES_DIR = join(import.meta.dirname, 'references')
const LOAD_SETTLE_MS = 4000
const SCROLL_SETTLE_MS = 1500
const OVERSCROLL_CAPTURE_DELAY_MS = 900
const OVERSCROLL_HOLD_S = 2.5
const OVERSCROLL_DISTANCE_PT = 260
const SCROLL_VELOCITY = 400
const FLING_VELOCITY = 6000
const SAFARI = 'com.apple.mobilesafari'
const TAB_CLOSE_SETTLE_S = 1.5
// Points inside the web view of an iPhone 17 Pro sized screen, clear of the toolbar.
const GESTURE_CENTER: Record<Scenario['orientation'], { x: number, y: number }> = { portrait: { x: 200, y: 450 }, landscape: { x: 437, y: 220 } }

const { values } = parseArgs({
  options: {
    udid: { type: 'string' },
    device: { type: 'string', default: 'iphone-17-pro' },
    ios: { type: 'string', default: '26' },
    port: { type: 'string', default: String(CALIBRATION_PORT) },
    cases: { type: 'string' },
    states: { type: 'string', default: SCROLL_STATES.join(',') },
    themes: { type: 'string', default: 'light' },
    orientations: { type: 'string', default: 'portrait' },
    overwrite: { type: 'boolean', default: false },
  },
})

if (!values.udid) throw new Error('--udid is required')
const selectedCases = values.cases ? corpus.filter(c => values.cases!.split(',').includes(c.name)) : corpus.filter(c => !c.name.startsWith('standalone'))
const states = values.states.split(',') as ScrollState[]
const themes = values.themes.split(',').filter(t => (THEMES as readonly string[]).includes(t)) as Scenario['theme'][]
const orientations = values.orientations.split(',').filter(o => (ORIENTATIONS as readonly string[]).includes(o)) as Scenario['orientation'][]

const port = Number(values.port)
const server = await startCalibrationServer(port)
let session = await openSimulatorSession(values.udid)
const failures: string[] = []
try {
  for (const theme of themes) {
    await run('xcrun', ['simctl', 'ui', values.udid, 'appearance', theme])
    for (const orientation of orientations) {
      await session.perform([{ action: 'orient', label: orientation }])
      for (const corpusCase of selectedCases) {
        for (const state of states) {
          const scenario: Scenario = { state, theme, orientation, mode: 'browser' }
          const dir = join(REFERENCES_DIR, `ios${values.ios}`, corpusCase.name)
          await mkdir(dir, { recursive: true })
          const stem = scenarioStem(values.device, scenario)
          const output = join(dir, `${stem}.png`)
          if (!values.overwrite && await access(output).then(() => true, () => false)) continue
          try {
            await captureState(session, corpusCase.name, stem, scenario, output)
            console.log(`${corpusCase.name} ${stem}`)
          } catch (error) {
            failures.push(`${corpusCase.name} ${stem}: ${error}`)
            console.error(`skipped ${corpusCase.name} ${stem}: ${error}`)
            await session.close()
            session = await openSimulatorSession(values.udid)
            await session.perform([{ action: 'orient', label: orientation }])
          }
        }
      }
    }
  }
} finally {
  await session.perform([{ action: 'orient', label: 'portrait' }]).catch(() => {})
  await session.close()
  server.close()
  if (failures.length) {
    console.error(`${failures.length} shots skipped:\n${failures.join('\n')}`)
    process.exitCode = 1
  }
}

async function captureState(session: SimulatorSession, caseName: string, stem: string, { state, orientation }: Scenario, output: string) {
  // Every openurl adds a tab; in landscape more than one tab brings up a tab bar that changes the geometry.
  // The iPhone home screen does not rotate, so the orientation is set again once Safari is in front.
  if (orientation === 'landscape') await session.perform([{ action: 'activate', app: SAFARI }, { action: 'orient', label: orientation }, { action: 'closeAllTabs', app: SAFARI }, { action: 'sleep', duration: TAB_CLOSE_SETTLE_S }])
  await session.open(`http://localhost:${port}/case/${caseName}?report=${referenceReportId(values.ios, caseName, stem)}&t=${Date.now()}`)
  await sleep(LOAD_SETTLE_MS)
  const { x: midX, y: midY } = GESTURE_CENTER[orientation]
  switch (state) {
    case 'initial':
      break
    case 'scrolled':
      await session.perform([{ action: 'swipe', label: 'up', velocity: SCROLL_VELOCITY }])
      await sleep(SCROLL_SETTLE_MS)
      break
    case 'overscroll-top':
      await session.performInBackground([{ action: 'drag', x: midX, y: midY - OVERSCROLL_DISTANCE_PT / 2, toX: midX, toY: midY + OVERSCROLL_DISTANCE_PT / 2, duration: 0.01, velocity: 1200, hold: OVERSCROLL_HOLD_S }])
      await sleep(OVERSCROLL_CAPTURE_DELAY_MS + 1000)
      break
    case 'overscroll-bottom':
      await session.perform([{ action: 'swipe', label: 'up', velocity: FLING_VELOCITY }, { action: 'swipe', label: 'up', velocity: FLING_VELOCITY }, { action: 'swipe', label: 'up', velocity: FLING_VELOCITY }])
      await sleep(SCROLL_SETTLE_MS * 2)
      await session.performInBackground([{ action: 'drag', x: midX, y: midY + OVERSCROLL_DISTANCE_PT / 2, toX: midX, toY: midY - OVERSCROLL_DISTANCE_PT / 2, duration: 0.01, velocity: 1200, hold: OVERSCROLL_HOLD_S }])
      await sleep(OVERSCROLL_CAPTURE_DELAY_MS + 1000)
      break
  }
  await session.screenshot(output)
  if (state.startsWith('overscroll')) await sleep(OVERSCROLL_HOLD_S * 1000)
}
