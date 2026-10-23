import { mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { corpus } from './corpus.ts'
import { startCalibrationServer, CALIBRATION_PORT } from './server.ts'
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

const { values } = parseArgs({
  options: {
    udid: { type: 'string' },
    device: { type: 'string', default: 'iphone-17-pro' },
    ios: { type: 'string', default: '26' },
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

const server = await startCalibrationServer()
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
            await captureState(session, corpusCase.name, stem, state, output)
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

async function captureState(session: SimulatorSession, caseName: string, stem: string, state: ScrollState, output: string) {
  await session.open(`http://localhost:${CALIBRATION_PORT}/case/${caseName}?report=${caseName}.${stem}&t=${Date.now()}`)
  await sleep(LOAD_SETTLE_MS)
  const midX = 200
  const midY = 450
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
