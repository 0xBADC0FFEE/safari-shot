import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, readdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const run = promisify(execFile)

const DRIVER_DIR = join(import.meta.dirname, 'driver')
const DRIVER_BUILD_DIR = join(import.meta.dirname, 'out', 'driver-build')
const POLL_MS = 100
const DRIVER_START_TIMEOUT_MS = 180_000
const COMMAND_TIMEOUT_MS = 60_000

export type DriverStep =
  | { action: 'activate', app?: string }
  | { action: 'tap', app?: string, x: number, y: number }
  | { action: 'drag', app?: string, x: number, y: number, toX: number, toY: number, duration?: number, hold?: number, velocity?: number }
  | { action: 'swipe', app?: string, label: 'up' | 'down', velocity?: number }
  | { action: 'tapLabel', app?: string, label: string, timeout?: number }
  | { action: 'typeText', app?: string, label: string }
  | { action: 'dumpTree', app?: string, label: string }
  | { action: 'sleep', duration: number }
  | { action: 'orient', label: 'portrait' | 'landscape' }
  | { action: 'quit' }

export interface SimulatorSession {
  readonly udid: string
  open(url: string): Promise<void>
  perform(steps: DriverStep[]): Promise<void>
  /** Starts the steps without waiting, for screenshots taken mid-gesture. */
  performInBackground(steps: DriverStep[]): Promise<void>
  screenshot(path: string): Promise<void>
  close(): Promise<void>
}

/**
 * Boots the simulator if needed, fixes the status bar and starts the XCUITest gesture driver.
 * @param udid simulator UDID
 * @returns a session that controls Safari on that simulator
 */
export async function openSimulatorSession(udid: string): Promise<SimulatorSession> {
  await bootSimulator(udid)
  await run('xcrun', ['simctl', 'status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged',
    '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3', '--dataNetwork', 'wifi'])
  const xctestrun = await buildDriver(udid)
  const mailbox = await mkdtemp(join(tmpdir(), 'simdriver-'))
  const driver = spawn('xcodebuild', ['test-without-building', '-xctestrun', xctestrun, '-destination', `id=${udid}`],
    { env: { ...process.env, TEST_RUNNER_SIMDRIVER_DIR: mailbox }, stdio: ['ignore', 'pipe', 'pipe'] })
  const driverLog: string[] = []
  driver.stdout.on('data', chunk => driverLog.push(String(chunk)))
  driver.stderr.on('data', chunk => driverLog.push(String(chunk)))
  await waitFor(() => exists(join(mailbox, 'ready')), DRIVER_START_TIMEOUT_MS, () => `driver did not start:\n${driverLog.join('').slice(-4000)}`)
  return createSession(udid, mailbox, driver)
}

function createSession(udid: string, mailbox: string, driver: ChildProcess): SimulatorSession {
  let commandCount = 0
  const send = async (steps: DriverStep[]) => {
    const id = `c${++commandCount}`
    await writeFile(join(mailbox, 'command.json'), JSON.stringify({ id, steps }))
    return id
  }
  const awaitDone = async (id: string) => {
    const donePath = join(mailbox, `done-${id}.json`)
    await waitFor(() => exists(donePath), COMMAND_TIMEOUT_MS, () => `driver command ${id} timed out`)
    const { errors } = JSON.parse(await readFile(donePath, 'utf8')) as { errors: string[] }
    if (errors.length) throw new Error(`driver errors: ${errors.join('; ')}`)
  }
  return {
    udid,
    async open(url) {
      await run('xcrun', ['simctl', 'openurl', udid, url])
    },
    async perform(steps) {
      await awaitDone(await send(steps))
    },
    async performInBackground(steps) {
      const id = await send(steps)
      void awaitDone(id).catch(error => console.error(error))
    },
    async screenshot(path) {
      await run('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', path])
    },
    async close() {
      await send([{ action: 'quit' }])
      await waitFor(async () => driver.exitCode !== null, COMMAND_TIMEOUT_MS, () => 'driver did not quit').catch(() => driver.kill())
      await rm(mailbox, { recursive: true, force: true })
    },
  }
}

async function bootSimulator(udid: string) {
  await run('xcrun', ['simctl', 'boot', udid]).catch(error => {
    if (!String(error.stderr).includes('Booted')) throw error
  })
  await run('xcrun', ['simctl', 'bootstatus', udid, '-b'])
}

async function buildDriver(udid: string) {
  await run('xcodebuild', ['build-for-testing', '-project', join(DRIVER_DIR, 'SimDriver.xcodeproj'), '-scheme', 'Driver',
    '-destination', `id=${udid}`, '-derivedDataPath', DRIVER_BUILD_DIR, '-quiet'], { maxBuffer: 64 * 1024 * 1024 })
  const productsDir = join(DRIVER_BUILD_DIR, 'Build', 'Products')
  const xctestrun = (await readdir(productsDir)).find(name => name.endsWith('.xctestrun'))
  if (!xctestrun) throw new Error(`no .xctestrun in ${productsDir}`)
  return join(productsDir, xctestrun)
}

async function exists(path: string) {
  return access(path).then(() => true, () => false)
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, describeFailure: () => string) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(POLL_MS)
  }
  throw new Error(describeFailure())
}
